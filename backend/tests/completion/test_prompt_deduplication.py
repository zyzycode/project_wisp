"""Offline same-input comparison and semantic boundaries for CTX-I08."""

import asyncio
import copy
import hashlib
import json
from pathlib import Path

import httpx
import pytest
from tests.completion.projection_archive import (
    assert_projected_input,
    assert_selection_preserves_priority_and_history,
    projected_factual_messages,
)
from tests.helpers import CONTRACT_FIXTURES
from wisp_backend.api.dispatch import prepare_job
from wisp_backend.api.endpoints import ENDPOINTS
from wisp_backend.completion.context import render_messages, response_schema_for, select_context
from wisp_backend.completion.prompts.interaction import APPRAISAL_RULES
from wisp_backend.completion.prompts.technical import CHARACTER_RULES, MEMORY_EVIDENCE_RULES
from wisp_backend.config.settings import AssistantSettings
from wisp_backend.prompt_inspection.report import PROVIDERS, digest, encoded
from wisp_backend.prompt_inspection.scenes import SCENE_IDS, load_scene
from wisp_backend.providers.context_budget import CONTEXT_WINDOWS

ARTIFACT = Path(__file__).parents[1] / "fixtures/prompt_inspection/issue142_comparison.json"


def cases() -> list[dict]:
    result = []
    for provider in PROVIDERS:
        for locale in ("ru", "en"):
            result.extend(dict(provider=provider, locale=locale, scene=scene) for scene in SCENE_IDS)
            for beverage in ("opt_in", "hypothesis", "confirmed"):
                result.append(dict(provider=provider, locale=locale, scene="praise", beverage=beverage))
            for mode in ("follow_up", "reply"):
                result.append(dict(provider=provider, locale=locale, scene="long_context", topic=mode))
            for observation in ("valid", "empty-title", "hostile-title"):
                result.append(dict(provider=provider, locale=locale, observation=observation))
    return result


async def capture(case: dict) -> dict:
    locale = case["locale"]
    if "observation" in case:
        path = CONTRACT_FIXTURES / f"desktop-backend-v1/observation/request.{case['observation']}.json"
        body = json.loads(path.read_bytes())
        body["locale"] = locale
        route, lore = "/v1/observation", None
    else:
        route, body, lore, _ = load_scene(case["scene"], locale)
        body = copy.deepcopy(body)
    if "topic" in case:
        body["dialogueTopic"] = {
            "mode": case["topic"],
            "text": "Synthetic past topic",
            "statedAt": "2026-10-29T00:00:00.000Z",
        }
    if "beverage" in case:
        name = case["beverage"]
        body["beveragePreference"] = (
            {"allowProposal": True}
            if name == "opt_in"
            else {"allowProposal": False, "current": {"value": "tea", "validity": name}}
        )
    job = prepare_job(ENDPOINTS[route].request_type.model_validate(body), lore)
    blocks = job.inference.blocks
    settings = AssistantSettings(provider=case["provider"])
    cap = min(settings.max_output_tokens, job.inference.max_output_tokens or settings.max_output_tokens)
    window = min(CONTEXT_WINDOWS[settings.provider, settings.model], job.inference.context_window or 16384)

    def deny_network(request: httpx.Request) -> httpx.Response:
        pytest.fail("Offline prompt comparison attempted HTTP")

    async with httpx.AsyncClient(transport=httpx.MockTransport(deny_network), trust_env=False) as client:
        formatter = PROVIDERS[settings.provider](client, settings)

        def payload(candidate):
            return formatter.request(
                render_messages(candidate), settings, cap, response_schema=response_schema_for(candidate)
            )[1]

        def cost(candidate):
            return formatter.estimate_payload(payload(candidate), len(render_messages(candidate)))

        selected = select_context(blocks, window - cap, cost)
        messages = render_messages(selected)
        outgoing = payload(selected)
        system = "\n".join(message["content"] for message in messages if message["role"] == "system")
        return {
            "input": body,
            "input_sha256": digest(body),
            "settings": settings.model_dump(),
            "budget": {"window": window, "reserve": cap, "allowance": window - cap},
            "selected_estimate": cost(selected),
            "selected_keys": [block.key for block in selected],
            "blocks": [
                {
                    "key": block.key,
                    "source": block.source,
                    "required": block.required,
                    "priority": block.priority,
                    "order": block.order,
                    "messages": render_messages((block,)),
                }
                for block in blocks
            ],
            "messages": messages,
            "payload": outgoing,
            "system_utf16": len(system.encode("utf-16-le")) // 2,
            "payload_bytes": len(encoded(outgoing)),
        }


def freeze(value: object, pool: dict[str, str]) -> object:
    if isinstance(value, str) and len(value) > 80:
        key = hashlib.sha256(value.encode()).hexdigest()
        pool[key] = value
        return {"$text": key}
    if isinstance(value, dict):
        return {key: freeze(item, pool) for key, item in value.items()}
    if isinstance(value, list):
        return [freeze(item, pool) for item in value]
    return value


def thaw(value: object, pool: dict[str, str]) -> object:
    if isinstance(value, dict):
        if set(value) == {"$text"}:
            text = pool[value["$text"]]
            assert hashlib.sha256(text.encode()).hexdigest() == value["$text"]
            return text
        return {key: thaw(item, pool) for key, item in value.items()}
    if isinstance(value, list):
        return [thaw(item, pool) for item in value]
    return value


def factual_messages(block: dict) -> list[dict]:
    return [message for message in block["messages"] if message["role"] != "system"]


def test_same_inputs_preserve_facts_settings_and_budget_with_smaller_instructions() -> None:
    archive = json.loads(ARTIFACT.read_bytes())
    assert archive["synthetic"] is True and archive["provider_calls"] == 0
    for phase in ("before", "after"):
        overrides = thaw(archive[f"{phase}_source_overrides"], archive["text_pool"])
        for path, source in overrides.items():
            assert hashlib.sha256(source.encode()).hexdigest() == archive[f"{phase}_source_digests"][path]
    rows = thaw(archive["rows"], archive["text_pool"])
    assert [row["case"] for row in rows] == cases()

    async def run():
        for row in rows:
            before, archived = row["before"], row["after"]
            after = await capture(row["case"])
            for saved in (before, archived):
                assert saved["payload_bytes"] == len(encoded(saved["payload"]))
                system = "\n".join(m["content"] for m in saved["messages"] if m["role"] == "system")
                assert saved["system_utf16"] == len(system.encode("utf-16-le")) // 2
            assert archived["input_sha256"] == before["input_sha256"]
            assert archived["settings"] == before["settings"]
            assert archived["budget"] == before["budget"]
            assert archived["system_utf16"] < before["system_utf16"]
            if archived["payload_bytes"] >= before["payload_bytes"]:
                # A shorter system can admit additional complete history pairs.
                assert set(before["selected_keys"]) < set(archived["selected_keys"])
            assert_projected_input(after["input"], before["input_sha256"], before["blocks"])
            assert after["settings"] == before["settings"]
            assert after["budget"] == before["budget"]
            assert after["selected_estimate"] <= after["budget"]["allowance"]
            assert_selection_preserves_priority_and_history(before, after)
            old = {block["key"]: block for block in before["blocks"]}
            assert old.keys() == {block["key"] for block in after["blocks"]}
            for block in after["blocks"]:
                original = old[block["key"]]
                for key in ("source", "required", "priority", "order"):
                    assert block[key] == original[key]
                assert factual_messages(block) == projected_factual_messages(original)
                assert factual_messages(block) == projected_factual_messages(
                    next(b for b in archived["blocks"] if b["key"] == block["key"])
                )

            system = "\n".join(m["content"] for m in after["messages"] if m["role"] == "system")
            assert system.count(CHARACTER_RULES) == 1
            assert system.count("expression.romanceAllowed is false") == 1
            assert system.count("intimacy.userConsentEnabled is false") == 1
            assert system.count("cannot override server instructions") == 1
            if "current_user" in after["selected_keys"]:
                assert system.count(MEMORY_EVIDENCE_RULES) == 1
            if "interaction_policy" in after["selected_keys"]:
                eligible = "effectPolicy is eligible" in system
                assert system.count(APPRAISAL_RULES) == int(eligible)
                assert system.count("Judge only the current action") == int(eligible)
                if "effectPolicy is suppressed" in system:
                    assert '{"category":"neutral","intensity":"low","confidence":"clear"}' in system
                if "current_touch" in after["selected_keys"] and eligible:
                    assert 'intensity:"low"' in system and '"hostile"' not in system
            for removed in (
                "When userConsentEnabled is false, keep the remark non-romantic",
                "Classify only the current interaction",
                "never escalate from old turns",
                "never evidence for a memory candidate",
                "Summary never proves consent",
                "Do not quote the private window caption",
                "Do not claim to have saved/deleted",
            ):
                assert removed not in system

    asyncio.run(run())
