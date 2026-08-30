"""
Project Wisp — Manifest Synchronization & Asset Routing Helper
==============================================================
Maps image files to canonical categories/prefixes and safely updates manifest.json.
"""

import hashlib
import json
import os
import re
from typing import Any, Dict, List, Optional, Tuple

from .config import CATEGORY_RULES, MANIFEST_PATH


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
]

OVERLAY_BODY_ANCHORS: Dict[str, Dict[str, Any]] = {
    "body_idle": {
        "faceOverlay": {
            "mode": "overlay",
            "anchor": "face",
            "allowedFaceKeys": STANDARD_ALLOWED_FACE_KEYS,
            "fallback": "face_happy",
        },
        "defaultAnchors": {"face": {"x": 256, "y": 126}},
        "frameMeta": [
            {},
            {"anchors": {"face": {"x": 256, "y": 124}}},
            {"anchors": {"face": {"x": 256, "y": 122}}},
        ],
    },
    "body_sit": {
        "faceOverlay": {
            "mode": "overlay",
            "anchor": "face",
            "allowedFaceKeys": STANDARD_ALLOWED_FACE_KEYS,
            "fallback": "face_happy",
        },
        "defaultAnchors": {"face": {"x": 256, "y": 140}},
    },
    "body_stand_up": {
        "faceOverlay": {
            "mode": "overlay",
            "anchor": "face",
            "allowedFaceKeys": STANDARD_ALLOWED_FACE_KEYS,
            "fallback": "face_happy",
        },
        "defaultAnchors": {"face": {"x": 256, "y": 130}},
    },
    "body_lie": {
        "faceOverlay": {
            "mode": "overlay",
            "anchor": "face",
            "allowedFaceKeys": STANDARD_ALLOWED_FACE_KEYS,
            "fallback": "face_happy",
        },
        "defaultAnchors": {"face": {"x": 256, "y": 320}},
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
        grid = (2, 4) if action in ("idle", "crash_splat") else (1, 4)
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
        return f"props/{prop_name}", f"prop_{prop_name}", (1, 1)

    # 2. Category rules (for legacy or localized names)
    for keywords, subfolder, prefix, grid in CATEGORY_RULES:
        if any(kw in clean_name for kw in keywords):
            return subfolder, prefix, grid

    # 3. Existing manifest entry
    if manifest and isinstance(manifest, dict):
        for key, val in manifest.items():
            if isinstance(val, dict):
                src = val.get("sourceFile", "")
                if src and (src.lower() == filename.lower() or os.path.splitext(src)[0].lower() == clean_name):
                    category = val.get("category", "")
                    count = val.get("framesCount", 4)
                    return category, key, (1, count)

        if clean_name in manifest:
            val = manifest[clean_name]
            if isinstance(val, dict):
                category = val.get("category", f"custom/{clean_name}")
                count = val.get("framesCount", 4)
                return category, clean_name, (1, count)

    safe_name = "".join(c if c.isalnum() or c in "_-" else "_" for c in clean_name)
    return f"custom/{safe_name}", safe_name, (1, 4)


def sync_manifest_entry(
    manifest: Dict[str, Any],
    prefix: str,
    category: str,
    frames: List[str],
    source_file: str
) -> None:
    """Updates or adds an animation entry into manifest structure."""
    if prefix in manifest and isinstance(manifest[prefix], dict):
        manifest[prefix]["category"] = category
        manifest[prefix]["framesCount"] = len(frames)
        manifest[prefix]["frames"] = frames
        manifest[prefix]["sourceFile"] = source_file
    else:
        entry: Dict[str, Any] = {
            "category": category,
            "framesCount": len(frames),
            "frames": frames,
            "sourceFile": source_file,
        }
        if "body" in category:
            entry["faceOverlay"] = {"mode": "baked_in", "fallback": "none"}
        manifest[prefix] = entry

    # Apply overlay configurations if applicable
    if prefix in OVERLAY_BODY_ANCHORS:
        ov_data = OVERLAY_BODY_ANCHORS[prefix]
        manifest[prefix]["faceOverlay"] = ov_data["faceOverlay"]
        manifest[prefix]["defaultAnchors"] = ov_data["defaultAnchors"]
        if "frameMeta" in ov_data:
            manifest[prefix]["frameMeta"] = ov_data["frameMeta"]
