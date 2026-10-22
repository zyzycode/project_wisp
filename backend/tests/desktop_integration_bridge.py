"""Bounded JSONL test transport into the current app, with only Groq HTTP mocked."""

import json
import sys
from pathlib import Path
from typing import cast

import httpx
from fastapi.testclient import TestClient
from pydantic import SecretStr
from wisp_backend.application import create_app
from wisp_backend.config.settings import Settings

INPUT_LIMIT = 64 * 1024
OUTPUT_LIMIT = 128 * 1024


def emit(value: object) -> None:
    encoded = json.dumps(value, ensure_ascii=False).encode("utf-8") + b"\n"
    if len(encoded) > OUTPUT_LIMIT:
        raise ValueError("Bridge output limit")
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def read_request(line: bytes) -> tuple[str, str, bytes]:
    value = json.loads(line)
    if not isinstance(value, dict) or set(value) != {"method", "path", "body"}:
        raise ValueError("Invalid bridge frame")
    method, path, body = value["method"], value["path"], value["body"]
    if (
        method != "POST"
        or path
        not in {
            "/v1/chat",
            "/v2/chat",
            "/v3/events",
            "/v3/chat",
            "/v5/summary",
            "/v5/chat",
            "/v6/observation",
            "/v7/touch",
            "/v7/chat",
        }
        or not isinstance(body, str)
    ):
        raise ValueError("Invalid bridge request")
    encoded = body.encode("utf-8")
    if len(encoded) > 32 * 1024:
        raise ValueError("Bridge request body limit")
    return method, path, encoded


def main() -> None:
    # The parent owns this unique temporary directory, including forced-exit cleanup.
    settings = Settings(api_key=SecretStr("synthetic-integration-key"), ledger_path=Path(sys.argv[1]))
    messages: list[dict[str, str]] = []
    upstream_calls = 0
    route = ""

    def upstream(request: httpx.Request) -> httpx.Response:
        nonlocal upstream_calls
        upstream_calls += 1
        payload = json.loads(request.content)
        raw_messages = payload.get("messages") if isinstance(payload, dict) else None
        if not isinstance(raw_messages, list) or not all(
            isinstance(item, dict)
            and set(item) == {"role", "content"}
            and isinstance(item["role"], str)
            and isinstance(item["content"], str)
            for item in raw_messages
        ):
            raise ValueError("Invalid provider messages")
        messages.extend(cast(list[dict[str, str]], raw_messages))
        text = {
            "/v7/touch": "Ой, лёгкое касание.",
            "/v7/chat": "Я отреагировала на твоё лёгкое касание.",
            "/v6/observation": "Может, сделать небольшую паузу?",
            "/v5/summary": "Пользователь обсуждал космос.",
            "/v5/chat": "Продолжим.",
            "/v3/events": "Мне нравится игра с курсором",
            "/v3/chat": "Давай ещё поиграем.",
        }.get(route, "Помню нашу игру, Мария.")
        reply: dict[str, object] = {"text": text}
        if route in {"/v7/touch", "/v7/chat"}:
            reply["appraisal"] = {"category": "neutral", "intensity": "low", "confidence": "clear"}
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": json.dumps(reply)}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 5, "completion_tokens": 2, "total_tokens": 7},
            },
        )

    with TestClient(create_app(httpx.MockTransport(upstream), settings=settings)) as client:
        emit({"ready": True})
        while True:
            line = sys.stdin.buffer.readline(INPUT_LIMIT + 1)
            if not line:
                break
            if len(line) > INPUT_LIMIT or not line.endswith(b"\n"):
                raise ValueError("Bridge input limit")
            method, path, body = read_request(line)
            route = path
            messages.clear()
            response = client.request(method, path, content=body, headers={"Content-Type": "application/json"})
            emit(
                {
                    "status": response.status_code,
                    "contentType": response.headers.get("content-type", ""),
                    "body": response.text,
                    "upstreamCalls": upstream_calls,
                    "upstreamMessages": messages,
                }
            )


if __name__ == "__main__":
    main()
