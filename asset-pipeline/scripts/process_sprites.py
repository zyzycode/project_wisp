#!/usr/bin/env python3
"""
Project Wisp — Sprite Sheet Processor CLI
=========================================
Processes raw PNG/WebP sheets from asset-pipeline/input/:
1. Detects grid dimensions & extracts frames (Connected components for body, uniform cells for faces/props).
2. Rescales and centers frames on a standardized 512x512 canvas.
3. Saves final PNGs directly to public/assets/sprites/<category>/<prefix>_<index>.png.
4. Writes metadata-only output/manifest-proposal.json and a local output cache.
The application manifest is read-only; no frame relocation is needed.

Usage:
  python3 asset-pipeline/scripts/process_sprites.py                # Process new/modified files
  python3 asset-pipeline/scripts/process_sprites.py --force        # Reprocess all files
  python3 asset-pipeline/scripts/process_sprites.py --file path    # Process specific file
"""

import argparse
import glob
import json
import os
import sys
from copy import deepcopy
from typing import Dict, List

# Virtual environment bootstrap & path setup
SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(os.path.dirname(SCRIPTS_DIR))
VENV_PYTHON = os.path.join(ROOT_DIR, ".venv", "bin", "python")

if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

def ensure_proper_python_environment():
    try:
        import scipy.ndimage
        import numpy
        from PIL import Image
    except ImportError:
        if os.path.exists(VENV_PYTHON) and sys.executable != VENV_PYTHON:
            os.execv(VENV_PYTHON, [VENV_PYTHON] + sys.argv)
        elif sys.executable != "/usr/bin/python3.13" and os.path.exists("/usr/bin/python3.13"):
            os.execv("/usr/bin/python3.13", ["/usr/bin/python3.13"] + sys.argv)

ensure_proper_python_environment()

import numpy as np
from PIL import Image

from lib.config import (
    CACHE_PATH,
    GENERATED_DIR,
    MANIFEST_PATH,
    SPRITES_DIR,
    EXPORT_TARGET,
    PROPOSAL_PATH,
    TARGET_BASELINE_Y,
    TARGET_BODY_HEIGHT,
    TARGET_CANVAS_SIZE,
)
from lib.grid_detector import detect_grid_dimensions, extract_frames_from_sheet
from lib.image_processor import crop_and_center_to_512, get_reference_scale
from lib.manifest_sync import get_file_hash, get_target_info, sync_manifest_entry, save_proposal
from lib.output_paths import output_path, prepare_output_file, sprite_directory, sprite_path, prepare_sprite_file


def process_single_image(
    image_path: str,
    output_base: str,
    manifest: dict,
    dry_run: bool = False
) -> bool:
    """Processes a single raw sprite sheet."""
    filename = os.path.basename(image_path)

    if filename.lower().startswith(("no_image", "ref.", "reference.", ".")):
        print(f"⏩ Пропуск служебного файла: {filename}")
        return False

    target_subfolder, target_prefix, expected_grid = get_target_info(filename, manifest)
    is_face = "faces" in target_subfolder

    sprite_directory(output_base)
    if os.path.basename(target_prefix) != target_prefix or any(c in target_prefix for c in "\\/*?[]"):
        raise ValueError(f"Invalid animation prefix: {target_prefix}")
    out_dir = str(sprite_directory(os.path.join(output_base, target_subfolder)))
    # Never delete old production frames: they may still be referenced by the
    # immutable working manifest. Overwrite only the frames produced below.

    img = Image.open(image_path).convert("RGBA")
    arr = np.array(img)
    if arr.shape[2] == 4:
        arr[:, :, 3] = np.where(arr[:, :, 3] < 15, 0, arr[:, :, 3])
        img = Image.fromarray(arr)

    rows, cols = detect_grid_dimensions(img, expected_grid, filename, is_face_overlay=is_face)
    width, height = img.size

    print(f"📦 [{filename}] -> нарезка PNG ({width}x{height}), сетка: {rows}x{cols} ({rows*cols} кадров) -> {target_subfolder}/{target_prefix}")

    raw_frames = extract_frames_from_sheet(img, rows, cols, is_face_overlay=is_face)
    sheet_scale = get_reference_scale(raw_frames, target_subfolder) if not is_face else 1.0

    if not is_face:
        print(f"    📐 Масштаб: scale={sheet_scale:.4f} (базовая высота: {TARGET_BODY_HEIGHT}px), извлечено кадров: {len(raw_frames)}")

    generated_frames: List[str] = []

    for frame_idx, cell in enumerate(raw_frames):
        final_frame = crop_and_center_to_512(
            cell,
            target_size=TARGET_CANVAS_SIZE,
            category=target_subfolder,
            baseline_y=TARGET_BASELINE_Y,
            scale=sheet_scale,
        )

        frame_filename = f"{target_prefix}_{frame_idx:02d}.png"
        frame_path = os.path.join(out_dir, frame_filename)
        if not dry_run:
            final_frame.save(prepare_sprite_file(frame_path, sources=[image_path]), "PNG")

        rel_url = "/assets/sprites/" + sprite_path(frame_path).relative_to(sprite_directory(SPRITES_DIR)).as_posix()
        generated_frames.append(rel_url)
        print(f"   ✓ Кадр {frame_idx+1:02d}/{len(raw_frames):02d} -> {target_subfolder}/{frame_filename}")

    previous_frames = manifest.get(target_prefix, {}).get("frames", [])
    if previous_frames and previous_frames != generated_frames:
        print(f"⚠️ {target_prefix}: frame list differs from the working metadata; update manifest separately.")
    existing_frames = glob.glob(os.path.join(out_dir, f"{target_prefix}_*.png"))
    extras = [path for path in existing_frames if (
        "/assets/sprites/" + sprite_path(path).relative_to(sprite_directory(SPRITES_DIR)).as_posix()
    ) not in generated_frames]
    if extras:
        print(f"⚠️ Preserved {len(extras)} extra frame(s) for {target_prefix}; review manifest references before removal.")

    if not dry_run:
        sync_manifest_entry(manifest, target_prefix, target_subfolder, generated_frames, filename)

    return True


def run_pipeline(
    input_file: str = None,
    force: bool = False,
    dry_run: bool = False
) -> None:
    # Resolve all destinations even when a cached run would not write frames.
    sprite_directory(SPRITES_DIR)
    for path in (PROPOSAL_PATH, CACHE_PATH):
        output_path(path)

    cache: Dict[str, str] = {}
    if os.path.exists(CACHE_PATH) and not force:
        try:
            with open(CACHE_PATH, "r", encoding="utf-8") as f:
                stored_cache = json.load(f)
                if stored_cache.get("exportTarget") == EXPORT_TARGET:
                    cache = stored_cache.get("sources", {})
        except (OSError, ValueError):
            cache = {}

    production_manifest = {}
    if os.path.exists(MANIFEST_PATH):
        with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
            production_manifest = json.load(f)
        print(f"📖 Read-only manifest: {MANIFEST_PATH}")

    candidates = {}
    if os.path.exists(PROPOSAL_PATH):
        with open(PROPOSAL_PATH, "r", encoding="utf-8") as f:
            proposal = json.load(f)
        if proposal.get("kind") != "wisp-asset-proposal":
            raise ValueError("Expected candidate metadata, not an application manifest")
        if proposal.get("exportTarget") == EXPORT_TARGET:
            candidates = proposal["entries"]
        else:
            print("ℹ️ Ignoring earlier staged proposal/cache; PNGs require direct export.")

    valid_exts = (".png", ".webp")
    if input_file:
        if not os.path.isfile(input_file):
            raise ValueError(f"Input file not found: {input_file}")
        all_files = [os.path.abspath(input_file)]
    else:
        all_files = [
            f for f in glob.glob(os.path.join(GENERATED_DIR, "*"))
            if os.path.isfile(f) and f.lower().endswith(valid_exts)
        ]

    all_files = [
        f for f in all_files
        if not os.path.basename(f).lower().startswith(("no_image", "ref.", "reference.", "."))
    ]
    if not all_files:
        print(f"ℹ️ No PNG/WebP sheets in {GENERATED_DIR}; add input or use --file.")
        return

    processed_count = 0
    for fpath in all_files:
        # Absolute source keys avoid sharing cached results between input folders.
        cache_key = os.path.realpath(fpath)
        current_hash = get_file_hash(fpath)
        routing = {**candidates, **production_manifest}
        prefix = get_target_info(os.path.basename(fpath), routing)[1]
        previous_frames = candidates.get(prefix, {}).get("frames", [])
        outputs_exist = bool(previous_frames) and all(
            frame.startswith("/assets/sprites/") and sprite_path(os.path.join(
                SPRITES_DIR, frame.removeprefix("/assets/sprites/")
            )).is_file()
            for frame in previous_frames
        )
        if cache.get(cache_key) == current_hash and outputs_exist and not force:
            continue

        # Copy metadata for this candidate only; never mirror all production assets.
        working_entries = deepcopy(routing)
        if process_single_image(fpath, SPRITES_DIR, working_entries, dry_run=dry_run):
            if not dry_run:
                candidates[prefix] = working_entries[prefix]
                cache[cache_key] = current_hash
            processed_count += 1

    if not dry_run and processed_count:
        save_proposal(candidates)
        with prepare_output_file(CACHE_PATH).open("w", encoding="utf-8") as f:
            json.dump({"exportTarget": EXPORT_TARGET, "sources": cache}, f, indent=2, ensure_ascii=False)

    print(f"✨ Processed {processed_count} sheet(s). Metadata proposal: {PROPOSAL_PATH}")


def main():
    parser = argparse.ArgumentParser(description="Project Wisp — Multi-Category Sprite Processor")
    parser.add_argument("--force", "-f", action="store_true", help="Force re-processing of all sheets ignoring cache")
    parser.add_argument("--file", type=str, default=None, help="Process single image file")
    parser.add_argument("--dry-run", action="store_true", help="Simulate without saving files")
    args = parser.parse_args()

    try:
        run_pipeline(input_file=args.file, force=args.force, dry_run=args.dry_run)
    except ValueError as exc:
        parser.error(str(exc))


if __name__ == "__main__":
    main()
