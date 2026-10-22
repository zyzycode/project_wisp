"""Closed synthetic corpus shipped beside the diagnostic command."""

import json
from pathlib import Path
from typing import Any

from wisp_backend.completion.prompts.lore import LoreCatalogue, parse_catalogue

SCENES_PATH = Path(__file__).with_name("scenes.json")
SCENE_IDS = (
    "greeting_low_trust",
    "greeting_high_trust",
    "praise",
    "tired",
    "combined_needs",
    "boundary",
    "touch",
    "touch_followup",
    "correction",
    "long_context",
    "injection",
    "no_match",
    "event_caught",
    "event_missed",
)


def load_scene(scene_id: str, locale: str) -> tuple[str, dict[str, Any], LoreCatalogue, dict[str, Any]]:
    if scene_id not in SCENE_IDS or locale not in ("ru", "en"):
        raise ValueError("Unknown synthetic scene or locale")
    corpus = json.loads(SCENES_PATH.read_text(encoding="utf-8"))
    if corpus["synthetic"] is not True or set(corpus["scenes"]) != set(SCENE_IDS):
        raise ValueError("Invalid synthetic corpus")
    scene = corpus["scenes"][scene_id][locale]
    metadata = {key: corpus[key] for key in ("corpus_id", "source_commit", "identity_source")}
    return scene["route"], scene["body"], parse_catalogue(corpus["lore"]), metadata
