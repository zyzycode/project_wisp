"""Explicit historical speech replay for frozen pre-#121 rollouts only."""

import hashlib
from collections.abc import Iterator
from pathlib import Path

import pytest
from wisp_backend.completion.prompts import resources


@pytest.fixture
def legacy_speech_resources(monkeypatch: pytest.MonkeyPatch) -> Iterator[resources.PromptResources]:
    path = Path(__file__).parents[1] / "fixtures/prompt_inspection/issue121_legacy_resources.json"
    raw = path.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == "b763715854a277b592a962cde1b1934339b4b5a527a5db3bf584fdb88bed0597"
    resources.get_prompt_resources.cache_clear()
    monkeypatch.setattr(resources, "RESOURCE_PATH", path)
    yield resources.parse_resources(raw)
    resources.get_prompt_resources.cache_clear()
