"""One inventory for routing, bounded HTTP input and OpenAPI error envelopes."""

from dataclasses import dataclass

from pydantic import BaseModel

from wisp_backend.api.schemas.chat import ChatRequest, ChatResponse
from wisp_backend.api.schemas.events import (
    EventAwareChatRequest, EventAwareChatResponse, EventRequest, EventResponse,
)
from wisp_backend.api.schemas.memory import MemoryRequest, MemoryResponse
from wisp_backend.api.schemas.touch import TouchRequest, TouchResponse
from wisp_backend.completion.policies import Scenario


BODY_TIMEOUT = 2
EVENT_BODY_TIMEOUT = .5


@dataclass(frozen=True)
class Endpoint:
    path: str
    version: int
    scenario: Scenario
    request_type: type[BaseModel]
    response_type: type[BaseModel]
    legacy_digest: bool = False

    @property
    def body_timeout(self) -> float:
        return EVENT_BODY_TIMEOUT if self.scenario is Scenario.EVENT else BODY_TIMEOUT


CHAT = Endpoint("/v1/chat", 1, Scenario.CHAT, ChatRequest, ChatResponse, legacy_digest=True)
TOUCH = Endpoint("/v1/touch", 1, Scenario.TOUCH, TouchRequest, TouchResponse)
MEMORY_CHAT = Endpoint("/v2/chat", 2, Scenario.MEMORY_CHAT, MemoryRequest, MemoryResponse)
EVENT_CHAT = Endpoint("/v3/chat", 3, Scenario.EVENT_CHAT, EventAwareChatRequest, EventAwareChatResponse)
EVENT = Endpoint("/v3/events", 3, Scenario.EVENT, EventRequest, EventResponse)
ENDPOINTS = {endpoint.path: endpoint for endpoint in (CHAT, TOUCH, MEMORY_CHAT, EVENT_CHAT, EVENT)}
ENDPOINTS_BY_REQUEST = {endpoint.request_type: endpoint for endpoint in ENDPOINTS.values()}
