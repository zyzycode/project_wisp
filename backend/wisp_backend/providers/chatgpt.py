"""ChatGPT plan Responses/SSE adapter; never falls back to paid API credentials."""
import codecs
from collections.abc import AsyncIterator

import httpx

from wisp_backend.chatgpt_http import ChatGPTError, MAX_BYTES, RESOURCE, list_models
from wisp_backend.chatgpt_session import ChatGPTSession
from wisp_backend.config import AssistantSettings
from wisp_backend.errors import ServiceError, invalid_response
from wisp_backend.json_codec import decode_json
from wisp_backend.schemas import ModelReply


async def events(response: httpx.Response) -> AsyncIterator[dict]:
    decoder = codecs.getincrementaldecoder("utf-8")()
    pending = ""
    data: list[str] = []
    size = 0
    async for chunk in response.aiter_bytes():
        size += len(chunk)
        if size > MAX_BYTES:
            raise invalid_response()
        pending += decoder.decode(chunk)
        while "\n" in pending:
            line, pending = pending.split("\n", 1)
            line = line.removesuffix("\r")
            if not line:
                if data:
                    raw = "\n".join(data)
                    data = []
                    if raw == "[DONE]":
                        continue
                    event = decode_json(raw)
                    if not isinstance(event, dict):
                        raise invalid_response()
                    yield event
            elif line.startswith("data:"):
                data.append(line[5:].removeprefix(" "))
    decoder.decode(b"", final=True)
    if pending.strip() or data:
        raise invalid_response()


def completed_reply(event: dict) -> ModelReply:
    response = event["response"]
    if response.get("status") != "completed":
        raise invalid_response()
    texts: list[str] = []
    for item in response["output"]:
        if item.get("type") == "reasoning":
            continue
        if item.get("type") != "message" or item.get("role") != "assistant" or item.get("status") != "completed":
            raise invalid_response()
        for part in item["content"]:
            if part.get("type") != "output_text" or not isinstance(part.get("text"), str):
                raise invalid_response()
            texts.append(part["text"])
    if len(texts) != 1:
        raise invalid_response()
    return ModelReply.model_validate(decode_json(texts[0]))


class ChatGPTProvider:
    def __init__(self, client: httpx.AsyncClient, session: ChatGPTSession):
        self.client = client
        self.session = session
        self.models: set[str] | None = None

    async def complete(self, messages: list[dict[str, str]], settings: AssistantSettings) -> ModelReply:
        try:
            token = await self.session.access_token()
            if self.models is None:
                self.models = {row["slug"] for row in await list_models(self.client, token)}
            model = self.session.record.get("model") if settings.model == "saved" else settings.model
            if model not in self.models:
                raise ChatGPTError("Choose a model available to this ChatGPT account.")
            payload = {
                "model": model, "store": False, "stream": True,
                "instructions": "\n".join(item["content"] for item in messages if item["role"] == "system"),
                "input": [item for item in messages if item["role"] != "system"],
            }
            async with self.client.stream("POST", RESOURCE + "/responses", json=payload,
                                          headers={"Authorization": "Bearer " + token}) as response:
                if not response.is_success:
                    if response.status_code in (401, 403):
                        self.session.failed = True
                    raise ServiceError("upstream_unavailable")
                if response.headers.get("content-type", "").split(";", 1)[0] != "text/event-stream":
                    raise invalid_response()
                async for event in events(response):
                    kind = event.get("type")
                    if kind == "response.completed":
                        return completed_reply(event)
                    if kind in {"response.failed", "response.incomplete", "error"}:
                        raise invalid_response()
            raise invalid_response()
        except httpx.TimeoutException:
            raise ServiceError("upstream_timeout") from None
        except (httpx.RequestError, ChatGPTError, OSError):
            raise ServiceError("upstream_unavailable") from None
        except (ValueError, KeyError, TypeError, AttributeError, RecursionError):
            raise invalid_response() from None
