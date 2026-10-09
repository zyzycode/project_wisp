"""Bounded HTTP helpers for fixed OpenAI OAuth/API endpoints."""
from typing import Any

import httpx

from wisp_backend.json_codec import decode_json

ISSUER = "https://auth.openai.com"
TOKEN_URL = ISSUER + "/api/accounts/oauth/token"
RESOURCE = "https://api.openai.com/v1"
PLAN_SCOPE = "chatgpt.tokens.use.direct"
MAX_BYTES = 256 * 1024


class ChatGPTError(Exception):
    """Safe local diagnostic; never include upstream bodies or credentials."""


async def read_json(client: httpx.AsyncClient, method: str, url: str, **kwargs: Any) -> dict:
    async with client.stream(method, url, **kwargs) as response:
        if response.status_code != 200:
            raise ChatGPTError("ChatGPT request rejected; check sign-in and plan access.")
        data = bytearray()
        async for chunk in response.aiter_bytes():
            if len(data) + len(chunk) > MAX_BYTES:
                raise ChatGPTError("ChatGPT response exceeded the local limit.")
            data.extend(chunk)
    try:
        value = decode_json(data.decode("utf-8"))
        if not isinstance(value, dict):
            raise ValueError
        return value
    except (ValueError, UnicodeError, RecursionError):
        raise ChatGPTError("Invalid ChatGPT response.") from None


async def list_models(client: httpx.AsyncClient, token: str) -> list[dict[str, str]]:
    data = await read_json(client, "GET", RESOURCE + "/models", headers={"Authorization": "Bearer " + token})
    rows = data.get("models")
    if not isinstance(rows, list):
        raise ChatGPTError("Invalid ChatGPT model catalog.")
    models = [row for row in rows if isinstance(row, dict) and row.get("visibility") == "list"
              and isinstance(row.get("slug"), str) and isinstance(row.get("display_name"), str)]
    if not models:
        raise ChatGPTError("No models available to this ChatGPT account.")
    return models
