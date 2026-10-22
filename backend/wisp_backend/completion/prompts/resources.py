"""Validated, immutable resources loaded once for the lifetime of this process."""

import hashlib
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Literal

from wisp_backend.completion.prompts.resource_schema import PromptTexts, ResourceDocument
from wisp_backend.json_codec import decode_json

RESOURCE_PATH = Path(__file__).with_name("prompt_resources.json")
RESOURCE_BYTE_LIMIT = 64 * 1024
Locale = Literal["ru", "en"]
Scenario = Literal["chat", "touch", "event"]
Predicate = Literal[
    "chat_guarded", "chat_playful_close", "chat_tired_company", "touch_familiar", "touch_gentle", "event_missed"
]
ExampleValue = str | tuple[str, ...]


@dataclass(frozen=True)
class StyleExample:
    id: str
    locale: Locale
    scenario: Scenario
    predicate: Predicate
    fields: tuple[tuple[str, ExampleValue], ...]

    def payload(self) -> dict[str, str | list[str]]:
        return {key: list(value) if isinstance(value, tuple) else value for key, value in self.fields}


@dataclass(frozen=True)
class PromptResources:
    revision: str
    sha256: str
    texts: PromptTexts
    examples: tuple[StyleExample, ...]


class PromptResourceError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("prompt_resources_unavailable")


def parse_resources(raw: bytes) -> PromptResources:
    """Validate the entire bounded document before publishing any resource."""
    if len(raw) > RESOURCE_BYTE_LIMIT:
        raise ValueError("Resource byte limit")
    document = ResourceDocument.model_validate(decode_json(raw.decode("utf-8")))
    identifiers: set[str] = set()
    predicates: set[tuple[Locale, Scenario, Predicate]] = set()
    examples = []
    locales: tuple[Locale, ...] = ("ru", "en")
    scenarios: tuple[Scenario, ...] = ("chat", "touch", "event")
    if (
        sum(len(getattr(getattr(document.examples, locale), scenario)) for locale in locales for scenario in scenarios)
        > 32
    ):
        raise ValueError("Example count limit")
    for locale in locales:
        catalogue = getattr(document.examples, locale)
        for scenario in scenarios:
            for entry in getattr(catalogue, scenario):
                if entry.id in identifiers:
                    raise ValueError("Duplicate example ID")
                identifiers.add(entry.id)
                predicate_key = (locale, scenario, entry.predicate)
                if predicate_key in predicates:
                    raise ValueError("Duplicate example predicate")
                predicates.add(predicate_key)
                fields = tuple(
                    (key, tuple(value) if isinstance(value, list) else value)
                    for key, value in entry.model_dump(exclude={"id", "predicate"}).items()
                )
                size = sum(
                    len(text.encode("utf-16-le")) // 2
                    for _, value in fields
                    for text in (value if isinstance(value, tuple) else (value,))
                )
                if size > 1200:
                    raise ValueError("Example text limit")
                examples.append(StyleExample(entry.id, locale, scenario, entry.predicate, fields))
    return PromptResources(document.revision, hashlib.sha256(raw).hexdigest(), document.texts, tuple(examples))


@cache
def get_prompt_resources() -> PromptResources:
    """Startup warms this process-wide snapshot; requests never reread its file."""
    try:
        with RESOURCE_PATH.open("rb") as resource_file:
            raw = resource_file.read(RESOURCE_BYTE_LIMIT + 1)
        return parse_resources(raw)
    except (OSError, ValueError, RecursionError):
        raise PromptResourceError() from None
