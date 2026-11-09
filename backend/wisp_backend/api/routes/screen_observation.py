"""Managed-only one-shot vision, separate from ordinary metadata observation."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from starlette.responses import Response
from wisp_backend.api.dependencies import get_completion_service
from wisp_backend.api.endpoints import SCREEN_OBSERVATION
from wisp_backend.api.responses import error_response, http_response
from wisp_backend.api.schemas.common import ErrorResponse
from wisp_backend.api.schemas.screen_observation import (
    ScreenObservationAvailable,
    ScreenObservationRequest,
    ScreenObservationUnavailable,
)
from wisp_backend.api.screen_observation import prepare_screen_job
from wisp_backend.completion.contracts import ScreenInferenceRequest
from wisp_backend.completion.service import CompletionService
from wisp_backend.providers import screen_observation as vision
from wisp_backend.providers.openai import OpenAIProvider

router = APIRouter(tags=["one-shot screen observation"])


def supported_profile(request: Request, service: CompletionService) -> bool:
    return (
        getattr(request.app.state, "managed_openai", False) is True
        and isinstance(service.provider, OpenAIProvider)
        and service.provider.settings.provider == "openai"
        and str(service.provider.client.base_url) == "https://api.openai.com/v1/"
    )


def screen_capability(
    request: Request, service: CompletionService
) -> ScreenObservationAvailable | ScreenObservationUnavailable:
    if not supported_profile(request, service):
        return ScreenObservationUnavailable(status="unavailable", reason="unsupported_profile")
    if not vision.VISION_POLICY_CONFIRMED:
        return ScreenObservationUnavailable(status="unavailable", reason="policy_unconfirmed")
    return ScreenObservationAvailable(
        status="available",
        provider="openai",
        model=vision.MODEL,
        policyRevision=vision.POLICY_REVISION,
    )


@router.get(
    SCREEN_OBSERVATION.path + "/capability",
    response_model=ScreenObservationAvailable | ScreenObservationUnavailable,
)
async def capability(
    request: Request, service: Annotated[CompletionService, Depends(get_completion_service)]
) -> ScreenObservationAvailable | ScreenObservationUnavailable:
    return screen_capability(request, service)


@router.post(
    SCREEN_OBSERVATION.path,
    response_model=SCREEN_OBSERVATION.response_type,
    responses={status: {"model": ErrorResponse} for status in (400, 401, 403, 409, 413, 429, 502, 503, 504)},
)
async def observe_screen(
    body: ScreenObservationRequest,
    request: Request,
    service: Annotated[CompletionService, Depends(get_completion_service)],
) -> Response:
    if screen_capability(request, service).status != "available":
        return error_response("upstream_unavailable", body.requestId)
    job = prepare_screen_job(body)
    assert isinstance(job.inference, ScreenInferenceRequest)
    if vision.estimate_vision_input(job.inference) + 512 > 16384:
        return error_response("upstream_unavailable", body.requestId)
    outcome = await service.complete(job, request.state.digest, request.state.started)
    return http_response(outcome)
