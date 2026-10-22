"""One inventory for routing, bounded HTTP input and OpenAPI error envelopes."""

from dataclasses import dataclass

from pydantic import BaseModel
from wisp_backend.api.schemas.events import EventRequest, EventResponse
from wisp_backend.api.schemas.interaction import (
    InteractionChatRequest,
    InteractionChatResponse,
    InteractionTouchRequest,
    InteractionTouchResponse,
)
from wisp_backend.api.schemas.observation import ObservationRequest, ObservationResponse
from wisp_backend.api.schemas.summary import SummaryRequest, SummaryResponse
from wisp_backend.completion.policies import Scenario

BODY_TIMEOUT = 2
EVENT_BODY_TIMEOUT = 0.5


@dataclass(frozen=True)
class Endpoint:
    path: str
    scenario: Scenario
    request_type: type[BaseModel]
    response_type: type[BaseModel]

    @property
    def body_timeout(self) -> float:
        return EVENT_BODY_TIMEOUT if self.scenario in (Scenario.EVENT, Scenario.OBSERVATION) else BODY_TIMEOUT


CHAT = Endpoint("/v1/chat", Scenario.INTERACTION_CHAT, InteractionChatRequest, InteractionChatResponse)
TOUCH = Endpoint("/v1/touch", Scenario.INTERACTION_TOUCH, InteractionTouchRequest, InteractionTouchResponse)
EVENT = Endpoint("/v1/events", Scenario.EVENT, EventRequest, EventResponse)
SUMMARY = Endpoint("/v1/summary", Scenario.SUMMARY, SummaryRequest, SummaryResponse)
OBSERVATION = Endpoint("/v1/observation", Scenario.OBSERVATION, ObservationRequest, ObservationResponse)
ENDPOINTS = {endpoint.path: endpoint for endpoint in (CHAT, TOUCH, EVENT, SUMMARY, OBSERVATION)}
ENDPOINTS_BY_REQUEST = {endpoint.request_type: endpoint for endpoint in ENDPOINTS.values()}
