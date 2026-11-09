"""Translate one crop into a noncached completion with exact ephemeral evidence."""

from dataclasses import dataclass

from pydantic import ValidationError
from starlette.responses import JSONResponse
from wisp_backend.api.responses import failure
from wisp_backend.api.schemas.screen_observation import (
    ScreenObservationEvidence,
    ScreenObservationRequest,
    ScreenObservationResponse,
)
from wisp_backend.completion.contracts import CompletionJob, ScreenInferenceRequest
from wisp_backend.errors import ErrorCode, ServiceError
from wisp_backend.json_codec import decode_json
from wisp_backend.outcomes import Outcome


@dataclass(frozen=True)
class ScreenReplyEncoder:
    request_id: str

    def success(self, text: str) -> Outcome:
        try:
            evidence = ScreenObservationEvidence.model_validate(decode_json(text))
            response = ScreenObservationResponse(requestId=self.request_id, observation=evidence)
            encoded = JSONResponse(response.model_dump()).body
        except (ValidationError, ValueError, TypeError, RecursionError):
            raise ServiceError("invalid_model_response") from None
        if len(encoded) > 4096:
            raise ServiceError("invalid_model_response")
        return Outcome(200, encoded)

    def failure(self, code: ErrorCode, retry_after_ms: int | None = None) -> Outcome:
        return failure(code, self.request_id, retry_after_ms)


def prepare_screen_job(body: ScreenObservationRequest) -> CompletionJob:
    return CompletionJob(
        request_id=body.requestId,
        inference=ScreenInferenceRequest(
            blocks=(),
            max_output_tokens=512,
            context_window=16384,
            image_base64=body.image.dataBase64,
            locale=body.locale,
            width=body.image.width,
            height=body.image.height,
        ),
        timeout=6,
        encoder=ScreenReplyEncoder(body.requestId),
        cache_result=False,
        exclusive=True,
    )
