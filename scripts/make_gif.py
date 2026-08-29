#!/usr/bin/env python3
"""
Project Wisp — Sprite Sheet & Frame-to-GIF Animator
===================================================
Скрипт для склеивания отдельных PNG-кадров или спрайт-листов в анимированные GIF.
По умолчанию сохраняет итоговую .gif прямо в ту же папку, где лежат кадры.

Примеры использования:
  1. Склеить все кадры из папки (гифка сохранится внутри этой же папки):
     python scripts/make_gif.py generated_images/new_generated

  2. Указать скорость (FPS):
     python scripts/make_gif.py generated_images/new_generated --fps 10

  3. Автоматически создать превью-гифки для ВСЕХ анимаций в проекте:
     python scripts/make_gif.py --all

Параметры:
  --fps [число]        Кадров в секунду (по умолчанию 8)
  --scale [число]      Масштаб вывода (например 0.5 для уменьшения веса, по умолчанию 1.0)
  --bg [цвет]          Цвет фона: transparent (по умолчанию), white, black, #f0f0f5
  --output, -o [путь]  (Опционально) Своё имя или путь к итоговому .gif файлу
"""

import os
import sys
import glob
import re
import argparse
from PIL import Image

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

try:
    RESAMPLE_LANCZOS = Image.Resampling.LANCZOS
except AttributeError:
    RESAMPLE_LANCZOS = Image.LANCZOS

def natural_sort_key(s):
    """Сортировка файлов по числам в именах (например 0, 1, 2... 10 вместо 0, 1, 10, 2)."""
    return [int(text) if text.isdigit() else text.lower() for text in re.split(r'(\d+)', s)]

def parse_color(color_str):
    if not color_str or color_str.lower() in ("none", "transparent", "alpha"):
        return None
    if color_str.lower() == "white":
        return (255, 255, 255, 255)
    if color_str.lower() == "black":
        return (0, 0, 0, 255)
    if color_str.startswith("#"):
        hex_c = color_str.lstrip("#")
        if len(hex_c) == 6:
            r = int(hex_c[0:2], 16)
            g = int(hex_c[2:4], 16)
            b = int(hex_c[4:6], 16)
            return (r, g, b, 255)
    return (240, 240, 245, 255)

def frames_to_gif(frame_paths, output_gif, fps=8, bg_color=None, scale=1.0):
    if not frame_paths:
        print("❌ Ошибка: список кадров пуст.")
        return False

    sorted_paths = sorted(frame_paths, key=natural_sort_key)
    print(f"🎬 Сборка GIF из {len(sorted_paths)} кадров ({fps} FPS)...")

    duration_ms = int(1000 / max(fps, 1))
    processed_frames = []

    for idx, p in enumerate(sorted_paths):
        im = Image.open(p).convert("RGBA")
        
        # Масштабирование при необходимости
        if scale != 1.0:
            nw = max(1, int(im.width * scale))
            nh = max(1, int(im.height * scale))
            im = im.resize((nw, nh), RESAMPLE_LANCZOS)

        # Обработка фона
        if bg_color is not None:
            bg = Image.new("RGBA", im.size, bg_color)
            bg.paste(im, (0, 0), im)
            frame_to_quant = bg.convert("RGB")
            quant = frame_to_quant.convert("P", palette=Image.ADAPTIVE, colors=256)
        else:
            # Честный прозрачный GIF
            alpha = im.getchannel("A")
            # Бинаризуем альфу для четких краев без черной каймы
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

    # Сохраняем как анимированный GIF
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
    print(f"🎉 Готово! GIF сохранён: {output_gif} ({size_kb:.1f} KB)\n")
    return True

def generate_all_project_gifs(fps=8):
    sprites_dir = os.path.join(ROOT_DIR, "public", "assets", "sprites")
    if not os.path.exists(sprites_dir):
        print(f"❌ Директория со спрайтами не найдена: {sprites_dir}")
        return

    print("🚀 Автоматическая генерация превью-гифок для всех категорий...\n")
    count = 0
    for root, dirs, files in os.walk(sprites_dir):
        pngs = [os.path.join(root, f) for f in files if f.lower().endswith((".png", ".webp")) and not f.endswith("_sheet.png") and not f.startswith("preview_")]
        if len(pngs) >= 2:
            rel_folder = os.path.relpath(root, sprites_dir)
            cat_name = rel_folder.replace(os.sep, "_")
            out_gif = os.path.join(root, f"preview_{cat_name}.gif")
            if frames_to_gif(pngs, out_gif, fps=fps):
                count += 1

    print(f"✨ Завершено! Создано {count} превью-гифок.")

def main():
    parser = argparse.ArgumentParser(description="Склеивание кадров в анимированный GIF")
    parser.add_argument("input", nargs="?", default="generated_images/new_generated", help="Папка с кадрами PNG или маска файлов")
    parser.add_argument("-o", "--output", default=None, help="Путь к итоговому GIF (по умолчанию сохраняется в ту же папку)")
    parser.add_argument("--fps", type=int, default=8, help="Частота кадров (FPS), по умолчанию 8")
    parser.add_argument("--scale", type=float, default=1.0, help="Масштаб разрешения (например 0.5)")
    parser.add_argument("--bg", default="transparent", help="Фон: transparent, white, black, #f0f0f5")
    parser.add_argument("--all", action="store_true", help="Сгенерировать гифки для ВСЕХ анимаций в public/assets/sprites/")

    args = parser.parse_args()

    if args.all:
        generate_all_project_gifs(fps=args.fps)
        return

    bg_color = parse_color(args.bg)
    input_path = args.input
    target_dir = None

    # Если передан путь к папке
    if os.path.isdir(input_path):
        target_dir = input_path
        frame_paths = [os.path.join(input_path, f) for f in os.listdir(input_path) if f.lower().endswith((".png", ".webp")) and not f.endswith("_sheet.png")]
    # Если передан glob паттерн
    elif "*" in input_path:
        frame_paths = glob.glob(input_path)
        if frame_paths:
            target_dir = os.path.dirname(frame_paths[0])
    else:
        full_p = os.path.join(ROOT_DIR, input_path)
        if os.path.isdir(full_p):
            target_dir = full_p
            frame_paths = [os.path.join(full_p, f) for f in os.listdir(full_p) if f.lower().endswith((".png", ".webp")) and not f.endswith("_sheet.png")]
        else:
            print(f"❌ Папка или файлы не найдены: {input_path}")
            return

    if not frame_paths:
        print(f"❌ В указанном пути нет PNG-файлов: {input_path}")
        return

    output_gif = args.output
    if not output_gif:
        folder_base = os.path.basename(os.path.abspath(target_dir)) if target_dir else "animation"
        output_gif = os.path.join(target_dir if target_dir else ".", f"{folder_base}.gif")

    frames_to_gif(frame_paths, output_gif, fps=args.fps, bg_color=bg_color, scale=args.scale)

if __name__ == "__main__":
    main()
