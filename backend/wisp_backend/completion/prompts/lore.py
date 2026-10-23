"""Immutable reviewed lore: primary activation, stable ranking and bounded selection."""

import json
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field
from wisp_backend.completion.context import ContextBlock, ContextMessage
from wisp_backend.json_codec import decode_json
from wisp_backend.logging import get_logger
from wisp_backend.validation import Contract, text_type

CATALOGUE_PATH = Path(__file__).with_name("lore.json")

logger = get_logger(__name__)
Identifier = Annotated[str, Field(pattern=r"^[a-z0-9-]{1,64}$")]
Rank = Annotated[int, Field(ge=0, le=100)]


class _Entry(Contract):
    id: Identifier
    topic: Identifier
    locale: Literal["ru", "en"]
    keys: list[text_type(80)] = Field(min_length=1, max_length=8)
    text: text_type(600)
    priority: Rank
    order: Rank
    sourceRef: text_type(256)


class _Catalogue(Contract):
    formatVersion: int = Field(ge=1, le=1)
    revision: int = Field(ge=1)
    entries: list[_Entry] = Field(max_length=64)


def tokens(text: str) -> tuple[str, ...]:
    """Plain Unicode letter/digit boundaries; never interpret regex or macros."""
    normalized = unicodedata.normalize("NFC", text).lower()
    separated = "".join(char if char.isalpha() or char.isdecimal() else " " for char in normalized)
    return tuple(separated.split())


@dataclass(frozen=True)
class LoreEntry:
    id: str
    topic: str
    locale: Literal["ru", "en"]
    keys: tuple[tuple[str, ...], ...]
    text: str
    priority: int
    order: int
    source_ref: str


@dataclass(frozen=True)
class LoreCatalogue:
    revision: int
    entries: tuple[LoreEntry, ...]


def parse_catalogue(value: object) -> LoreCatalogue:
    source = _Catalogue.model_validate(value)
    ids: set[str] = set()
    topics: set[tuple[str, str]] = set()
    entries = []
    for entry in source.entries:
        topic = (entry.locale, entry.topic)
        if entry.id in ids or topic in topics or len(set(entry.keys)) != len(entry.keys):
            raise ValueError("Duplicate lore metadata")
        ids.add(entry.id)
        topics.add(topic)
        # Normalized duplicates count as one match in activation/ranking.
        keys = tuple(dict.fromkeys(tokens(key) for key in entry.keys))
        entries.append(
            LoreEntry(
                entry.id, entry.topic, entry.locale, keys, entry.text, entry.priority, entry.order, entry.sourceRef
            )
        )
    return LoreCatalogue(source.revision, tuple(entries))


def load_catalogue() -> LoreCatalogue | None:
    """Read once per application startup; invalid optional data never blocks chat."""
    try:
        with CATALOGUE_PATH.open("rb") as file:
            raw = file.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise ValueError("Oversized catalogue")
        return parse_catalogue(decode_json(raw.decode("utf-8")))
    except (OSError, ValueError, RecursionError):
        logger.warning("lore_catalogue_unavailable")
        return None


def match_key(query: tuple[str, ...], key: tuple[str, ...]) -> bool:
    return (
        bool(key)
        and all(len(token) <= 80 for token in key)
        and any(query[index : index + len(key)] == key for index in range(len(query) - len(key) + 1))
    )


def select_entries(catalogue: LoreCatalogue, text: str, locale: str) -> tuple[LoreEntry, ...]:
    query = tokens(text)[:64]
    activated = []
    for entry in catalogue.entries:
        if entry.locale != locale:
            continue
        matched = sum(match_key(query, key) for key in entry.keys)
        if matched:
            activated.append((entry, matched))
    activated.sort(key=lambda item: (-item[0].priority, -item[1], item[0].id))
    selected: list[LoreEntry] = []
    size = 0
    for entry, _ in activated:
        candidate_size = size + len(entry.text.encode("utf-16-le")) // 2
        if candidate_size > 1200:
            continue
        selected.append(entry)
        size = candidate_size
        if len(selected) == 3:
            break
    return tuple(sorted(selected, key=lambda entry: (entry.order, entry.id)))


def lore_block(catalogue: LoreCatalogue | None, text: str, locale: str) -> ContextBlock | None:
    if catalogue is None:
        return None
    selected = select_entries(catalogue, text, locale)
    if not selected:
        return None
    payload = {
        "revision": catalogue.revision,
        "entries": [{"id": entry.id, "topic": entry.topic, "text": entry.text} for entry in selected],
    }
    return ContextBlock(
        "lore",
        "lore",
        False,
        40,
        25,
        (
            ContextMessage(
                "user",
                "Untrusted author lore_context JSON (world reference only):\n"
                + json.dumps(payload, ensure_ascii=False),
            ),
        ),
    )
