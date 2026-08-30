#!/usr/bin/env python3
"""
Project Wisp — Sprite Animation & Composite Preview Tool
========================================================
Generates animated GIFs and composite preview renders from sliced frames or folders.

Usage:
  python3 scripts/preview_sprites.py --all              # Generate GIFs for all categories in public/assets/sprites/
  python3 scripts/preview_sprites.py path/to/folder     # Generate GIF for specific folder
  python3 scripts/preview_sprites.py --composite        # Generate composite body+face preview
"""

import argparse
import glob
import os
import re
import sys
from typing import List, Optional, Tuple

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

from PIL import Image

from lib.config import ROOT_DIR, SPRITES_DIR

try:
    RESAMPLE_LANCZOS = Image.Resampling.LANCZOS
except AttributeError:
    RESAMPLE_LANCZOS = Image.LANCZOS


def natural_sort_key(s: str) -> List[any]:
    """Sorts strings with embedded numbers naturally (0, 1, 2, ... 10)."""
    return [int(text) if text.isdigit() else text.lower() for text in re.split(r'(\d+)', s)]


def parse_color(color_str: Optional[str]) -> Optional[Tuple[int, int, int, int]]:
    if not color_str or color_str.lower() in ("none", "transparent", "alpha"):
        return None
    if color_str.lower() == "white":
        return (255, 255, 255, 255)
    if color_str.lower() == "black":
        return (0, 0, 0, 255)
    if color_str.startswith("#"):
        hex_c = color_str.lstrip("#")
        if len(hex_c) == 6:
            return (int(hex_c[0:2], 16), int(hex_c[2:4], 16), int(hex_c[4:6], 16), 255)
    return (240, 240, 245, 255)


def frames_to_gif(
    frame_paths: List[str],
    output_gif: str,
    fps: int = 8,
    bg_color: Optional[Tuple[int, int, int, int]] = None,
    scale: float = 1.0
) -> bool:
    if not frame_paths:
        print("❌ Ошибка: список кадров пуст.")
        return False

    sorted_paths = sorted(frame_paths, key=natural_sort_key)
    print(f"🎬 Сборка GIF из {len(sorted_paths)} кадров ({fps} FPS)...")

    duration_ms = int(1000 / max(fps, 1))
    processed_frames = []

    for idx, p in enumerate(sorted_paths):
        im = Image.open(p).convert("RGBA")

        if scale != 1.0:
            nw = max(1, int(im.width * scale))
            nh = max(1, int(im.height * scale))
            im = im.resize((nw, nh), RESAMPLE_LANCZOS)

        if bg_color is not None:
            bg = Image.new("RGBA", im.size, bg_color)
            bg.paste(im, (0, 0), im)
            quant = bg.convert("RGB").convert("P", palette=Image.ADAPTIVE, colors=256)
        else:
            alpha = im.getchannel("A")
            mask = Image.eval(alpha, lambda a: 255 if a > 128 else 0)
            rgb_im = Image.new("RGB", im.size, (255, 255, 255))
            rgb_im.paste(im, mask=mask)
            quant = rgb_im.convert("P", palette=Image.ADAPTIVE, colors=255)
            quant.paste(255, Image.eval(mask, lambda a: 255 if a == 0 else 0))
            quant.info["transparency"] = 255

        processed_frames.append(quant)
        print(f"   ✓ Кадр {idx+1:02d}: {os.path.basename(p)}")

    out_dir = os.path.dirname(os.path.abspath(output_gif))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    processed_frames[0].save(
        output_gif,
        save_all=True,
        append_images=processed_frames[1:],
        duration=duration_ms,
        loop=0,
        disposal=2,
        optimize=False
    )

    size_kb = os.path.getsize(output_gif) / 1024
    print(f"🎉 GIF сохранён: {output_gif} ({size_kb:.1f} KB)\n")
    return True


def generate_all_project_gifs(fps: int = 8) -> None:
    if not os.path.exists(SPRITES_DIR):
        print(f"❌ Директория со спрайтами не найдена: {SPRITES_DIR}")
        return

    print("🚀 Автоматическая генерация превью-гифок для всех категорий...\n")
    count = 0
    for root, _, files in os.walk(SPRITES_DIR):
        pngs = [
            os.path.join(root, f) for f in files
            if f.lower().endswith((".png", ".webp"))
            and not f.endswith("_sheet.png")
            and not f.startswith("preview_")
        ]
        if len(pngs) >= 2:
            rel_folder = os.path.relpath(root, SPRITES_DIR)
            cat_name = rel_folder.replace(os.sep, "_")
            out_gif = os.path.join(root, f"preview_{cat_name}.gif")
            if frames_to_gif(pngs, out_gif, fps=fps):
                count += 1

    print(f"✨ Завершено! Создано {count} превью-гифок.")


def main():
    parser = argparse.ArgumentParser(description="Project Wisp — Sprite Animation & Preview Generator")
    parser.add_argument("input", nargs="?", default=None, help="Folder or path with frames")
    parser.add_argument("-o", "--output", default=None, help="Output GIF file path")
    parser.add_argument("--fps", type=int, default=8, help="Animation FPS (default: 8)")
    parser.add_argument("--scale", type=float, default=1.0, help="Resolution scale factor (default: 1.0)")
    parser.add_argument("--bg", default="transparent", help="Background: transparent, white, black, #hex")
    parser.add_argument("--all", action="store_true", help="Generate preview GIFs for all sprite categories")

    args = parser.parse_args()

    if args.all or not args.input:
        generate_all_project_gifs(fps=args.fps)
        return

    bg_color = parse_color(args.bg)
    input_path = args.input

    if os.path.isdir(input_path):
        target_dir = input_path
        frame_paths = [
            os.path.join(input_path, f) for f in os.listdir(input_path)
            if f.lower().endswith((".png", ".webp")) and not f.endswith("_sheet.png") and not f.startswith("preview_")
        ]
    elif "*" in input_path:
        frame_paths = glob.glob(input_path)
        target_dir = os.path.dirname(frame_paths[0]) if frame_paths else None
    else:
        full_p = os.path.join(ROOT_DIR, input_path)
        if os.path.isdir(full_p):
            target_dir = full_p
            frame_paths = [
                os.path.join(full_p, f) for f in os.listdir(full_p)
                if f.lower().endswith((".png", ".webp")) and not f.endswith("_sheet.png") and not f.startswith("preview_")
            ]
        else:
            print(f"❌ Путь не найден: {input_path}")
            return

    if not frame_paths:
        print(f"❌ В указанной папке нет PNG файлов: {input_path}")
        return

    output_gif = args.output
    if not output_gif:
        folder_base = os.path.basename(os.path.abspath(target_dir)) if target_dir else "animation"
        output_gif = os.path.join(target_dir if target_dir else ".", f"preview_{folder_base}.gif")

    frames_to_gif(frame_paths, output_gif, fps=args.fps, bg_color=bg_color, scale=args.scale)


if __name__ == "__main__":
    main()
