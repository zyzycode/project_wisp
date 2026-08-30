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


def get_target_info(filename: str, manifest: Optional[Dict[str, Any]] = None) -> Tuple[str, str, Tuple[int, int]]:
    """
    Determines category, animation key prefix, and expected grid from filename / manifest.
    Returns (subfolder, prefix, grid).
    """
    clean_name = os.path.splitext(filename)[0].strip().lower()

    # 1. Category rules
    for keywords, subfolder, prefix, grid in CATEGORY_RULES:
        if any(kw in clean_name for kw in keywords):
            return subfolder, prefix, grid

    # 2. Existing manifest entry
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

    # 3. Direct prefixes
    m_body = re.match(r"^body[_\-\s]+(.+)$", clean_name)
    if m_body:
        action = m_body.group(1).strip(" _-")
        return f"body/{action}", f"body_{action}", (1, 4)

    m_face = re.match(r"^face[_\-\s]+(.+)$", clean_name)
    if m_face:
        emotion = m_face.group(1).strip(" _-")
        return f"faces/{emotion}", f"face_{emotion}", (1, 4)

    m_pupils = re.match(r"^pupils?[_\-\s]+(.+)$", clean_name)
    if m_pupils:
        sub = m_pupils.group(1).strip(" _-")
        return "faces/pupils", f"pupils_{sub}", (1, 4)

    m_prop = re.match(r"^prop[_\-\s]+(.+)$", clean_name)
    if m_prop:
        prop_name = m_prop.group(1).strip(" _-")
        return f"props/{prop_name}", f"prop_{prop_name}", (1, 1)

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
