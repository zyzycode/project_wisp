"""Music uses ordinary chat; the removed topic protocol is no longer accepted."""

import json

import pytest
from pydantic import ValidationError
from tests.helpers import CONTRACT_FIXTURES
from wisp_backend.api.dispatch import prepare_job
from wisp_backend.api.schemas.interaction import InteractionChatRequest
from wisp_backend.completion.context import render_messages


def chat_body() -> dict:
    path = CONTRACT_FIXTURES / "desktop-backend-v1/interaction/request.chat.json"
    body = json.loads(path.read_bytes())
    body["messages"][-1]["content"] = "Давай обсудим джаз, метал и музыку к фильмам."
    return body


def test_removed_music_topic_is_rejected() -> None:
    body = chat_body()
    body["musicTopic"] = {
        "scope": "text_discussion",
        "topic": "jazz",
        "characterInterest": "unknown",
        "intention": "ask_music_detail",
    }
    with pytest.raises(ValidationError):
        InteractionChatRequest.model_validate(body)


def test_music_conversation_has_no_special_prompt_instructions() -> None:
    body = chat_body()
    blocks = prepare_job(InteractionChatRequest.model_validate(body)).inference.blocks
    messages = render_messages(blocks)
    assert messages[-1] == {"role": "user", "content": body["messages"][-1]["content"]}
    assert all(block.key != "music_topic" for block in blocks)
    system = "\n".join(message["content"] for message in messages if message["role"] == "system")
    assert "ask_music_detail" not in system
    assert "Never infer hearing music" not in system
