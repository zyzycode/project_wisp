"""
Project Wisp — Candidate Metadata & Asset Routing Helper
==============================================================
Maps source files to categories and proposes metadata for PNG exports; never writes the application manifest.
"""

import hashlib
import json
import os
import re
from typing import Any, Dict, List, Optional, Tuple

from copy import deepcopy
from .config import CATEGORY_RULES, PROPOSAL_PATH, EXPORT_TARGET
from .output_paths import prepare_output_file


def get_file_hash(filepath: str) -> str:
    """Calculates MD5 hash for incremental caching."""
    hasher = hashlib.md5()
    with open(filepath, "rb") as f:
        hasher.update(f.read())
    return hasher.hexdigest()


STANDARD_ALLOWED_FACE_KEYS: List[str] = [
    "face_happy",
    "face_sad",
    "face_shocked",
    "face_sleep",
    "face_talking",
    "face_thinking",
    "face_angry",
    "face_pout",
    "face_winking",
    "face_curious",
    "face_dizzy",
    "face_flirty",
    "face_gaze",
]

OVERLAY_BODY_ANCHORS: Dict[str, Dict[str, Any]] = {
    "body_idle": {
        "faceOverlay": {
            "mode": "overlay",
            "anchor": "face",
            "allowedFaceKeys": STANDARD_ALLOWED_FACE_KEYS,
            "fallback": "face_happy",
        },
        "defaultAnchors": {"face": {"x": 256, "y": 180}},
        "frameMeta": [
            {"anchors": {"face": {"x": 256, "y": 180}}},
            {"anchors": {"face": {"x": 256, "y": 176}}},
            {"anchors": {"face": {"x": 256, "y": 174}}},
            {"anchors": {"face": {"x": 256, "y": 181}}},
        ],
    },
    "body_sit": {
        "faceOverlay": {
            "mode": "overlay",
            "anchor": "face",
            "allowedFaceKeys": STANDARD_ALLOWED_FACE_KEYS,
            "fallback": "face_happy",
        },
        "defaultAnchors": {"face": {"x": 256, "y": 180}},
    },
    "body_stand_up": {
        "faceOverlay": {
            "mode": "overlay",
            "anchor": "face",
            "allowedFaceKeys": STANDARD_ALLOWED_FACE_KEYS,
            "fallback": "face_happy",
        },
        "defaultAnchors": {"face": {"x": 256, "y": 180}},
    },
    "body_lie": {
        "faceOverlay": {
            "mode": "overlay",
            "anchor": "face",
            "allowedFaceKeys": STANDARD_ALLOWED_FACE_KEYS,
            "fallback": "face_happy",
        },
        "defaultAnchors": {"face": {"x": 256, "y": 280}},
    },
}


def get_target_info(filename: str, manifest: Optional[Dict[str, Any]] = None) -> Tuple[str, str, Tuple[int, int]]:
    """
    Determines category, animation key prefix, and expected grid from filename / manifest.
    Returns (subfolder, prefix, grid).
    """
    clean_name = os.path.splitext(filename)[0].strip().lower()

    # 1. Direct canonical ASCII prefixes
    m_body = re.match(r"^body[_\-\s]+([a-z0-9_]+)$", clean_name)
    if m_body:
        action = m_body.group(1).strip(" _-")
        grid = (2, 4) if action in ("crash_splat",) else (1, 4)
        subfolder = "body/sleep_transition" if action in ("sleep_trans", "sleep_transition") else f"body/{action}"
        return subfolder, f"body_{action}", grid

    m_face = re.match(r"^face[_\-\s]+([a-z0-9_]+)$", clean_name)
    if m_face:
        emotion = m_face.group(1).strip(" _-")
        if emotion in ("blush", "flirt"):
            return "faces/flirty", "face_flirty", (1, 4)
        if emotion in ("surprised", "shock", "shocked"):
            return "faces/shocked", "face_shocked", (1, 4)
        return f"faces/{emotion}", f"face_{emotion}", (1, 4)

    m_pupils = re.match(r"^pupils?[_\-\s]+([a-z0-9_]+)$", clean_name)
    if m_pupils:
        sub = m_pupils.group(1).strip(" _-")
        return "faces/pupils", f"pupils_{sub}", (1, 4)

    m_prop = re.match(r"^prop[_\-\s]+([a-z0-9_]+)$", clean_name)
    if m_prop:
        prop_name = m_prop.group(1).strip(" _-")
        return f"props/{prop_name}", f"prop_{prop_name}", (1, 4)

    # 2. Match against manifest if already registered
    if manifest:
        for anim_key, entry in manifest.items():
            if entry.get("sourceFile") == filename:
                cat = entry.get("category", "")
                grid = (2, 4) if anim_key in ("body_crash_splat",) else (1, 4)
                return cat, anim_key, grid

    # 3. Match against CATEGORY_RULES
    for keywords, target_sub, prefix, grid in CATEGORY_RULES:
        for kw in keywords:
            if kw in clean_name:
                return target_sub, prefix, grid

    # 4. Fallback default
    return "custom/" + clean_name, clean_name, (1, 4)


def sync_manifest_entry(
    manifest: Dict[str, Any],
    anim_key: str,
    target_subfolder: str,
    frames: List[str],
    source_filename: str,
) -> None:
    """Updates or creates a manifest entry for the sliced animation."""
    category_parts = target_subfolder.split("/")
    main_cat = category_parts[0]

    entry = deepcopy(manifest.get(anim_key, {}))
    entry["category"] = target_subfolder
    entry["framesCount"] = len(frames)
    entry["frames"] = frames
    entry["sourceFile"] = source_filename

    if main_cat == "body":
        if anim_key in OVERLAY_BODY_ANCHORS:
            for k, v in OVERLAY_BODY_ANCHORS[anim_key].items():
                entry[k] = deepcopy(v)
        elif "faceOverlay" not in entry:
            entry["faceOverlay"] = {"mode": "baked_in", "fallback": "none"}

    manifest[anim_key] = entry


def save_proposal(entries: Dict[str, Any], path: str = PROPOSAL_PATH) -> None:
    """Save metadata proposals with canonical asset URLs, never a live manifest."""
    proposal = {
        "kind": "wisp-asset-proposal",
        "exportTarget": EXPORT_TARGET,
        "note": "PNGs exported directly. Review metadata/anchors/grid; application manifest is unchanged.",
        "entries": entries,
    }
    with prepare_output_file(path).open("w", encoding="utf-8") as f:
        json.dump(proposal, f, indent=2, ensure_ascii=False)
