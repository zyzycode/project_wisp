"""Bounded JSONL test transport into the current app, with only OpenAI HTTP mocked."""

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
        or path not in {"/v1/chat", "/v1/events", "/v1/summary", "/v1/observation", "/v1/touch"}
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
            "/v1/touch": "Ой, лёгкое касание.",
            "/v1/chat": "Я отреагировала на твоё лёгкое касание.",
            "/v1/observation": "Может, сделать небольшую паузу?",
            "/v1/summary": "Пользователь обсуждал космос.",
            "/v1/events": "Мне нравится игра с курсором",
        }[route]
        reply: dict[str, object] = {"text": text}
        if route in {"/v1/touch", "/v1/chat"}:
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
