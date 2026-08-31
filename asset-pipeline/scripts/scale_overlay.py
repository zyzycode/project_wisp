"""
Project Wisp — Standalone Overlay & Pupil Rescaler Tool
======================================================
Rescales already sliced 512x512 overlay sprites (pupils, faces, props)
by a customizable multiplier. Production PNGs can be updated in place; external
source sheets and references remain read-only. Final exports stay in public/assets/sprites/.

Usage:
  .venv/bin/python asset-pipeline/scripts/scale_overlay.py --folder public/assets/sprites/faces/pupils --scale 0.65
  .venv/bin/python asset-pipeline/scripts/scale_overlay.py --folder public/assets/sprites/faces/pupils --scale 0.70 --offset-y -5
  .venv/bin/python asset-pipeline/scripts/scale_overlay.py --help
"""

import argparse
import glob
import math
import os
import sys
from PIL import Image

from lib.output_paths import sprite_directory, prepare_sprite_file

try:
    RESAMPLE_FILTER = Image.Resampling.LANCZOS
except AttributeError:
    RESAMPLE_FILTER = Image.LANCZOS


def rescale_sprites_in_folder(
    folder_path: str,
    scale_factor: float,
    offset_x: int = 0,
    offset_y: int = 0,
    output_dir: str = None,
) -> int:
    """
    Finds all PNG files in folder_path, crops to non-transparent bbox,
    rescales by scale_factor, and pastes back centered (with optional offset)
    onto a same-size transparent canvas. Only production PNGs may change in place.
    """
    if not math.isfinite(scale_factor) or scale_factor <= 0:
        raise ValueError("Scale must be a finite positive number")
    if output_dir is None:
        try:
            output_dir = str(sprite_directory(folder_path))
        except ValueError as exc:
            raise ValueError("External input requires --output inside public/assets/sprites/") from exc
    output_dir = str(sprite_directory(output_dir))
    if not os.path.isdir(folder_path):
        print(f"[ERROR] Directory not found: {folder_path}", file=sys.stderr)
        return 0

    png_files = sorted(glob.glob(os.path.join(folder_path, "*.png")))
    if not png_files:
        print(f"[WARN] No PNG files found in {folder_path}")
        return 0

    processed_count = 0

    for file_path in png_files:
        if file_path.endswith(".bak.png") or file_path.endswith(".bak"):
            continue

        destination = prepare_sprite_file(
            os.path.join(output_dir, os.path.basename(file_path)), sources=png_files,
            allow_in_place=True,
        )
        try:
            img = Image.open(file_path).convert("RGBA")
            bbox = img.getbbox()
            if not bbox:
                continue

            orig_cx = (bbox[0] + bbox[2]) // 2
            orig_cy = (bbox[1] + bbox[3]) // 2

            cropped = img.crop(bbox)
            cw, ch = cropped.size

            new_w = max(1, int(round(cw * scale_factor)))
            new_h = max(1, int(round(ch * scale_factor)))

            resized = cropped.resize((new_w, new_h), RESAMPLE_FILTER)

            # Center at original center plus optional offset
            target_cx = orig_cx + offset_x
            target_cy = orig_cy + offset_y

            pos_x = target_cx - (new_w // 2)
            pos_y = target_cy - (new_h // 2)

            canvas = Image.new("RGBA", img.size, (0, 0, 0, 0))
            canvas.paste(resized, (pos_x, pos_y), resized)

            canvas.save(destination, "PNG")
            processed_count += 1
            print(f"  [OK] Rescaled: {os.path.basename(file_path)} ({cw}x{ch} -> {new_w}x{new_h})")

        except Exception as e:
            print(f"  [FAIL] Could not process {file_path}: {e}", file=sys.stderr)

    return processed_count


def main():
    parser = argparse.ArgumentParser(description="Standalone sprite rescaler for Project Wisp.")
    parser.add_argument(
        "--folder",
        "-f",
        type=str,
        required=True,
        help="Path to folder containing 512x512 sprites to rescale (e.g. public/assets/sprites/faces/pupils)",
    )
    parser.add_argument(
        "--scale",
        "-s",
        type=float,
        required=True,
        help="Scale multiplier (e.g. 0.65 for 65%% of current size, 0.70 for 70%%)",
    )
    parser.add_argument(
        "--offset-x",
        "-x",
        type=int,
        default=0,
        help="Horizontal shift in pixels (negative = left, positive = right)",
    )
    parser.add_argument(
        "--offset-y",
        "-y",
        type=int,
        default=0,
        help="Vertical shift in pixels (negative = up, positive = down)",
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Final PNG folder inside public/assets/sprites/; default: edit a production --folder in place",
    )

    args = parser.parse_args()
    print(f"=== Scaling sprites in: {args.folder} (scale: {args.scale}, offset: ({args.offset_x}, {args.offset_y})) ===")
    try:
        count = rescale_sprites_in_folder(
            folder_path=args.folder,
            scale_factor=args.scale,
            offset_x=args.offset_x,
            offset_y=args.offset_y,
            output_dir=args.output,
        )
    except ValueError as exc:
        parser.error(str(exc))
    print(f"Done! {count} production PNG(s) written; application manifest unchanged.")


if __name__ == "__main__":
    main()
