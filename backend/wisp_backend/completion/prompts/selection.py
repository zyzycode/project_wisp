"""Select author phrasing using desktop semantic cues, never numeric state thresholds."""

from dataclasses import dataclass

from wisp_backend.completion.context import ContextBlock, ContextMessage
from wisp_backend.completion.prompts.context import CharacterPromptContext, EventContext
from wisp_backend.completion.prompts.resources import Predicate, Scenario, StyleExample, get_prompt_resources


@dataclass(frozen=True)
class ResourceDecision:
    key: str
    kind: str
    predicate: str
    included: bool
    reason: str
    block_key: str


@dataclass(frozen=True)
class PromptSelection:
    guidance: tuple[ContextBlock, ...]
    examples: tuple[StyleExample, ...]
    decisions: tuple[ResourceDecision, ...]


def _matches(predicate: Predicate, context: CharacterPromptContext, mode: Scenario) -> bool:
    expression = context.expression
    if predicate == "event_missed":
        return (
            mode == "event"
            and isinstance(context, EventContext)
            and context.event.get("type") == "cursor_game_completed"
            and context.event.get("outcome") == "missed"
        )
    if context.user_consent_enabled:
        return False
    if predicate == "chat_familiar":
        return mode == "chat" and expression.pace == "normal" and expression.trust == "familiar"
    if predicate == "chat_guarded":
        return mode == "chat" and expression.pace == "normal" and expression.trust == "guarded"
    if predicate == "chat_playful_close":
        return (
            mode == "chat" and expression.pace == "normal" and expression.trust == "close" and expression.play == "high"
        )
    if predicate == "chat_tired_company":
        return mode == "chat" and expression.pace == "gentle" and expression.attention == "high"
    if predicate == "touch_familiar":
        return mode == "touch" and expression.pace == "normal" and expression.trust in ("familiar", "close")
    return predicate == "touch_gentle" and mode == "touch" and expression.pace == "gentle"


def select_prompt_resources(context: CharacterPromptContext, mode: Scenario) -> PromptSelection:
    resources = get_prompt_resources()
    expression = context.expression
    conditions = (
        ("gentle", expression.pace == "gentle", resources.texts.gentle),
        ("company", expression.attention == "high", resources.texts.company),
        ("play", expression.pace == "normal" and expression.play == "high", resources.texts.play),
        ("trust", expression.trust in ("guarded", "close"), resources.texts.trust),
    )
    decisions = []
    guidance = []
    for index, (name, included, text) in enumerate(conditions):
        key = f"guidance_{index}_{name}"
        reason = (
            "matched"
            if included
            else "gentle_suppresses_play" if name == "play" and expression.pace == "gentle" else "no_match"
        )
        decisions.append(ResourceDecision(key, "guidance", name, included, reason, key))
        if included:
            guidance.append(ContextBlock(key, "server_instructions", False, 20, 1, (ContextMessage("system", text),)))
    selected = []
    for entry in resources.examples:
        reason = (
            "locale_mismatch"
            if entry.locale != context.locale
            else (
                "scenario_mismatch"
                if entry.scenario != mode
                else "matched" if _matches(entry.predicate, context, mode) else "no_match"
            )
        )
        included = reason == "matched"
        decisions.append(ResourceDecision(entry.id, "example", entry.predicate, included, reason, "examples"))
        if included:
            selected.append(entry)
    return PromptSelection(tuple(guidance), tuple(selected), tuple(decisions))
