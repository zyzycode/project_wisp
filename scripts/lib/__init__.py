"""
Project Wisp — Sprite Pipeline Core Library
===========================================
Modular tools for grid detection, image processing, and manifest synchronization.
"""

from .config import (
    ROOT_DIR,
    SPRITES_DIR,
    GENERATED_DIR,
    MANIFEST_PATH,
    CACHE_PATH,
    CATEGORY_RULES,
    TARGET_CANVAS_SIZE,
    TARGET_BASELINE_Y,
    TARGET_BODY_HEIGHT,
    TARGET_FACE_WIDTH,
    TARGET_FACE_MAX_HEIGHT,
    TARGET_FACE_CENTER_X,
    TARGET_FACE_CENTER_Y,
)
from .grid_detector import detect_grid_dimensions, extract_frames_from_sheet
from .image_processor import crop_and_center_to_512, get_reference_scale, calculate_character_anchor
from .manifest_sync import get_file_hash, get_target_info, sync_manifest_entry

__all__ = [
    "ROOT_DIR",
    "SPRITES_DIR",
    "GENERATED_DIR",
    "MANIFEST_PATH",
    "CACHE_PATH",
    "CATEGORY_RULES",
    "TARGET_CANVAS_SIZE",
    "TARGET_BASELINE_Y",
    "TARGET_BODY_HEIGHT",
    "TARGET_FACE_WIDTH",
    "TARGET_FACE_MAX_HEIGHT",
    "TARGET_FACE_CENTER_X",
    "TARGET_FACE_CENTER_Y",
    "detect_grid_dimensions",
    "extract_frames_from_sheet",
    "crop_and_center_to_512",
    "get_reference_scale",
    "calculate_character_anchor",
    "get_file_hash",
    "get_target_info",
    "sync_manifest_entry",
]
