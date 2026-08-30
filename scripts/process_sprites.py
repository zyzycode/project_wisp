#!/usr/bin/env python3
"""
Project Wisp — Sprite Sheet Processor CLI
=========================================
Processes raw PNG sheets from generated_images/:
1. Detects grid dimensions & extracts frames (Connected components for body, uniform cells for faces/props).
2. Rescales and centers frames on a standardized 512x512 canvas.
3. Saves frames to public/assets/sprites/<category>/<prefix>_<index>.png.
4. Updates public/assets/sprites/manifest.json and cache.

Usage:
  python3 scripts/process_sprites.py                # Process new/modified files
  python3 scripts/process_sprites.py --force        # Reprocess all files
  python3 scripts/process_sprites.py --file path    # Process specific file
"""

import argparse
import glob
import json
import os
import sys
from typing import Dict, List, Set

# Virtual environment bootstrap & path setup
SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPTS_DIR)
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
    TARGET_BASELINE_Y,
    TARGET_BODY_HEIGHT,
    TARGET_CANVAS_SIZE,
)
from lib.grid_detector import detect_grid_dimensions, extract_frames_from_sheet
from lib.image_processor import crop_and_center_to_512, get_reference_scale
from lib.manifest_sync import get_file_hash, get_target_info, sync_manifest_entry


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

    out_dir = os.path.join(output_base, target_subfolder)
    if not dry_run:
        os.makedirs(out_dir, exist_ok=True)
        # Clean old frames for this prefix
        for old_f in glob.glob(os.path.join(out_dir, f"{target_prefix}_*.png")):
            try:
                os.remove(old_f)
            except OSError:
                pass

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
            final_frame.save(frame_path, "PNG")

        rel_url = f"/assets/sprites/{target_subfolder}/{frame_filename}"
        generated_frames.append(rel_url)
        print(f"   ✓ Кадр {frame_idx+1:02d}/{len(raw_frames):02d} -> {target_subfolder}/{frame_filename}")

    if not dry_run:
        sync_manifest_entry(manifest, target_prefix, target_subfolder, generated_frames, filename)

    return True


def run_pipeline(
    input_file: str = None,
    force: bool = False,
    dry_run: bool = False
) -> None:
    os.makedirs(GENERATED_DIR, exist_ok=True)
    os.makedirs(SPRITES_DIR, exist_ok=True)

    cache: Dict[str, str] = {}
    if os.path.exists(CACHE_PATH) and not force:
        try:
            with open(CACHE_PATH, "r", encoding="utf-8") as f:
                cache = json.load(f)
        except Exception:
            cache = {}

    manifest: Dict[str, any] = {}
    if os.path.exists(MANIFEST_PATH):
        try:
            with open(MANIFEST_PATH, "r", encoding="utf-8") as f:
                manifest = json.load(f)
                print(f"📖 Загружен манифест ({MANIFEST_PATH}) с {len(manifest)} записями.")
        except Exception as e:
            print(f"⚠️ Ошибка чтения {MANIFEST_PATH}: {e}, создается новый манифест.")
            manifest = {}

    valid_exts = (".png", ".webp")
    if input_file:
        all_files = [os.path.abspath(input_file)] if os.path.isfile(input_file) else []
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
        print(f"ℹ️ В папке {GENERATED_DIR} пока нет PNG файлов. Поместите прозрачные PNG спрайт-листы в generated_images/")
        return

    print(f"🚀 Проверка файлов ({len(all_files)} шт.)...")
    if force:
        print("⚡ Включен режим принудительной перезаписи (--force)!")

    processed_count = 0
    for fpath in all_files:
        fname = os.path.basename(fpath)
        current_hash = get_file_hash(fpath)

        if cache.get(fname) == current_hash and not force:
            continue

        if process_single_image(fpath, SPRITES_DIR, manifest, dry_run=dry_run):
            cache[fname] = current_hash
            processed_count += 1

    if not dry_run:
        # Prune manifest entries for files that no longer exist on disk
        active_prefixes: Set[str] = {
            get_target_info(os.path.basename(f), manifest)[1] for f in all_files
        }
        manifest = {
            k: v for k, v in manifest.items()
            if k in active_prefixes or os.path.exists(os.path.join(SPRITES_DIR, v.get("category", ""), f"{k}_00.png"))
        }

        with open(CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(cache, f, indent=2, ensure_ascii=False)

        with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)

    if processed_count > 0:
        print(f"\n🎉 Успешно обработано: {processed_count} листов (Lanczos 512x512)!")
        print(f"📄 Манифест: {MANIFEST_PATH}")
    else:
        print("✨ Все файлы уже актуальны. Используйте --force для принудительной перегенерации.")


def main():
    parser = argparse.ArgumentParser(description="Project Wisp — Multi-Category Sprite Processor")
    parser.add_argument("--force", "-f", action="store_true", help="Force re-processing of all sheets ignoring cache")
    parser.add_argument("--file", type=str, default=None, help="Process single image file")
    parser.add_argument("--dry-run", action="store_true", help="Simulate without saving files")
    args = parser.parse_args()

    run_pipeline(input_file=args.file, force=args.force, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
