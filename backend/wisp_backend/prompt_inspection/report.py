"""Inspect real preparation, selection and provider formatting on synthetic data."""

import hashlib
import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

import httpx
from wisp_backend.api.dispatch import prepare_job
from wisp_backend.api.endpoints import ENDPOINTS
from wisp_backend.completion.context import (
    ContextBlock,
    ContextOverflow,
    SelectionDecision,
    render_messages,
    response_schema_for,
    select_context,
)
from wisp_backend.config.settings import AssistantSettings
from wisp_backend.prompt_inspection.scenes import load_scene
from wisp_backend.providers.context_budget import CONTEXT_WINDOWS
from wisp_backend.providers.gemini import GeminiProvider
from wisp_backend.providers.http_provider import HTTPProvider
from wisp_backend.providers.openai import OpenAIProvider

PROVIDERS: dict[str, type[HTTPProvider]] = {"gemini": GeminiProvider, "openai": OpenAIProvider}
RUBRIC = ("character", "coherence", "non_repetition", "state_boundaries", "memory", "appraisal")


def encoded(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def digest(value: object) -> str:
    return hashlib.sha256(encoded(value)).hexdigest()


def source_digests() -> dict[str, str]:
    root = Path(__file__).resolve().parents[1]
    paths = [*sorted((root / "completion/prompts").glob("*.py")), *sorted((root / "completion/prompts").glob("*.json"))]
    paths += [root / name for name in ("completion/context.py", "completion/policies.py", "api/dispatch.py")]
    paths += [root / "providers" / name for name in ("gemini.py", "openai.py", "http_provider.py", "context_budget.py")]
    paths += [Path(__file__).with_name("scenes.json")]
    paths += [root / "prompt_inspect.py", *sorted(Path(__file__).parent.glob("*.py"))]
    paths += sorted((root / "api/schemas").glob("*.py"))
    return {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}


def _deny_network(request: httpx.Request) -> httpx.Response:
    raise RuntimeError("Offline inspection cannot use HTTP")


def _absent_optionals(route: str, blocks: tuple[ContextBlock, ...]) -> list[dict[str, str]]:
    keys = {block.key for block in blocks}
    absent: list[dict[str, str]] = []
    if route != "/v1/chat":
        return absent
    absent.extend(
        {"key": key, "reason": "no_match" if key == "lore" else "input_absent"}
        for key in ("summary", "lore", "previous_initiative", "previous_touch")
        if key not in keys
    )
    if not any(key.startswith("history_") for key in keys):
        absent.append({"key": "history", "reason": "empty_history"})
    return absent


async def inspect_scene(
    scene_id: str,
    locale: str = "en",
    provider: str = "openai",
    model: str | None = None,
    *,
    max_output_tokens: int = 4096,
    temperature: float | None = None,
    thinking_level: str | None = None,
    budget_case: str = "normal",
    beverage_case: str | None = None,
) -> dict[str, Any]:
    """No arbitrary text/path/env input; only finite scenes, models and diagnostic budgets."""
    if provider not in PROVIDERS or budget_case not in ("normal", "required_only", "overflow"):
        raise ValueError("Unsupported inspection settings")
    options: dict[str, Any] = {"provider": provider, "max_output_tokens": max_output_tokens}
    if model is not None:
        options["model"] = model
    options.update(temperature=temperature, thinking_level=thinking_level)
    settings = AssistantSettings.model_validate(options)
    if (provider, settings.model) not in CONTEXT_WINDOWS:
        raise ValueError("Unsupported inspection model")
    if settings.thinking_level is not None and (
        provider != "gemini" or (settings.model == "gemini-3.8-flash" and settings.thinking_level == "minimal")
    ):
        raise ValueError("Unsupported inspection thinking level")
    if settings.model == "gpt-6-astra" and settings.temperature is not None:
        raise ValueError("Unsupported inspection temperature")
    route, body, lore, metadata = load_scene(scene_id, locale)
    if beverage_case is not None:
        variants = {
            "opt_in": {"allowProposal": True},
            "hypothesis": {"allowProposal": False, "current": {"value": "coffee", "validity": "hypothesis"}},
            "confirmed": {"allowProposal": False, "current": {"value": "tea", "validity": "confirmed"}},
        }
        if route != "/v1/chat" or beverage_case not in variants:
            raise ValueError("Unsupported synthetic beverage case")
        body = {**body, "beveragePreference": variants[beverage_case]}
        metadata = {**metadata, "beverage_case": beverage_case}
    validated = ENDPOINTS[route].request_type.model_validate(body)
    job = prepare_job(validated, lore)
    blocks = job.inference.blocks
    cap = min(settings.max_output_tokens, job.inference.max_output_tokens or settings.max_output_tokens)
    window = min(CONTEXT_WINDOWS[(provider, settings.model)], job.inference.context_window or 16384)
    trace: list[SelectionDecision] = []
    async with httpx.AsyncClient(transport=httpx.MockTransport(_deny_network), trust_env=False) as client:
        formatter = PROVIDERS[provider](client, settings)

        def size(candidate: tuple[ContextBlock, ...]) -> int:
            messages = render_messages(candidate)
            return formatter.estimate_payload(
                formatter.request(messages, settings, cap, response_schema=response_schema_for(candidate))[1],
                len(messages),
            )

        required_size = size(tuple(block for block in blocks if block.required))
        allowance = window - cap
        if budget_case != "normal":
            allowance = required_size - (budget_case == "overflow")
        selected: tuple[ContextBlock, ...] = ()
        status = "ok"
        try:
            selected = select_context(blocks, allowance, size, trace=trace)
        except ContextOverflow:
            status = "required_overflow"
        messages = render_messages(selected)
        payload = (
            formatter.request(messages, settings, cap, response_schema=response_schema_for(selected))[1]
            if status == "ok"
            else None
        )
        decisions = {decision.key: decision for decision in trace}
        details = []
        for block in sorted(blocks, key=lambda item: (item.order, item.key)):
            content = "".join(message.content for message in block.messages)
            details.append(
                {
                    "key": block.key,
                    "source": block.source,
                    "required": block.required,
                    "priority": block.priority,
                    "order": block.order,
                    "roles": [message.role for message in block.messages],
                    "utf8_bytes": len(content.encode("utf-8")),
                    "utf16_units": len(content.encode("utf-16-le")) // 2,
                    "standalone_estimate": size((block,)),
                    "decision": asdict(decisions[block.key]),
                    "messages_sha256": digest(render_messages((block,))),
                }
            )
        final_estimate = size(selected) if status == "ok" else None

    return {
        "synthetic": True,
        **metadata,
        "scene_id": scene_id,
        "locale": locale,
        "route": route,
        "settings": settings.model_dump(),
        "budget_case": budget_case,
        "status": status,
        "measurement": {
            "method": "offline_estimate",
            "formula": formatter.estimate_method,
            "not_tokenizer_or_billing": True,
            "provider_count": "NOT RUN",
            "generation": "NOT RUN",
            "gemini_selection_is_estimated": provider == "gemini",
            "block_estimates_are_not_additive": True,
        },
        "budget": {
            "context_window": window,
            "output_reserve": cap,
            "input_allowance": allowance,
            "required_estimate": required_size,
            "selected_estimate": final_estimate,
        },
        "blocks": details,
        "absent_optional": _absent_optionals(route, blocks),
        "selected_keys": [block.key for block in selected],
        "messages": messages,
        "payload": payload,
        "messages_sha256": digest(messages),
        "payload_sha256": digest(payload),
        "payload_utf8_bytes": len(encoded(payload)) if payload is not None else None,
        "source_digests": source_digests(),
        "live_comparison": {
            "status": "NOT RUN",
            "before_response": "NOT RUN",
            "after_response": "NOT RUN",
            "scores_0_to_2": {axis: "NOT RUN" for axis in RUBRIC},
            "hard_failures": "NOT RUN (consent, evidence, format)",
        },
    }
