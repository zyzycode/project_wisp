#!/usr/bin/env python3
"""
Project Wisp — Gemini Background Remover & Sprite Processor
===========================================================
Integrates the professional chroma key remover engine with automatic
sprite slicing, scaling, centering, and asset deployment.

Usage:
  python3 scripts/process_gemini_sprites.py
  python3 scripts/process_gemini_sprites.py --file generated_images/gemini/face_curious.jpg --debug
"""

import os
import sys
import glob
import argparse
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
sys.path.insert(0, SCRIPT_DIR)

from chroma_key_remover import remove_chroma_key

GEMINI_DIR = os.path.join(PROJECT_ROOT, "generated_images", "gemini")
SPRITES_ROOT = os.path.join(PROJECT_ROOT, "public", "assets", "sprites")
PREVIEW_DIR = os.path.join(SPRITES_ROOT, "body", "idle", "delete_me")
BODY_IDLE_00 = os.path.join(SPRITES_ROOT, "body", "idle", "body_idle_00.png")

TARGET_FACE_WIDTH = 115
TARGET_FACE_MAX_HEIGHT = 90
TARGET_FACE_CENTER_X = 256
TARGET_FACE_CENTER_Y = 180

TARGET_BODY_CENTER_X = 256
TARGET_BODY_BASELINE_Y = 460
TARGET_BODY_HEIGHT = 388

RESAMPLE_LANCZOS = getattr(Image, "Resampling", Image).LANCZOS


def isolate_cell_features(cell: Image.Image, is_face: bool = True) -> Image.Image:
    """
    Cleans up noise specks and outer vignette frames touching cell boundaries.
    """
    arr = np.array(cell)
    alpha = arr[:, :, 3]
    h, w = alpha.shape

    visited = np.zeros((h, w), dtype=bool)
    clean_alpha = alpha.copy()

    for y in range(h):
        for x in range(w):
            if alpha[y, x] > 25 and not visited[y, x]:
                queue = [(y, x)]
                visited[y, x] = True
                pts = []
                while queue:
                    cy, cx = queue.pop()
                    pts.append((cy, cx))
                    for ny, nx in [(cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)]:
                        if 0 <= ny < h and 0 <= nx < w:
                            if alpha[ny, nx] > 25 and not visited[ny, nx]:
                                visited[ny, nx] = True
                                queue.append((ny, nx))

                ys = [p[0] for p in pts]
                xs = [p[1] for p in pts]
                ymin, ymax = min(ys), max(ys)
                xmin, xmax = min(xs), max(xs)
                count = len(pts)

                # Filter out tiny noise specks (< 12 pixels)
                if count < 12:
                    for py, px in pts:
                        clean_alpha[py, px] = 0
                    continue

                if is_face:
                    # Remove components touching outer 8px boundary (vignettes/frames)
                    touches_edge = (ymin < 8) or (ymax > h - 8) or (xmin < 8) or (xmax > w - 8)
                    cx_comp = (xmin + xmax) / 2.0
                    cy_comp = (ymin + ymax) / 2.0
                    dist_from_center = np.sqrt((cx_comp - w / 2.0) ** 2 + (cy_comp - h / 2.0) ** 2)

                    if touches_edge or (dist_from_center > w * 0.44 and count > 500):
                        for py, px in pts:
                            clean_alpha[py, px] = 0

    arr[:, :, 3] = clean_alpha
    return Image.fromarray(arr, "RGBA")


def process_face_strip(transparent_img: Image.Image, emotion_name: str):
    """
    Slices a 1x4 horizontal face sheet, scales facial features to character size,
    and centers them onto 512x512 PNG-32 canvas.
    """
    w, h = transparent_img.size
    num_frames = 4
    cell_w = w // num_frames
    out_dir = os.path.join(SPRITES_ROOT, "faces", emotion_name)
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(PREVIEW_DIR, exist_ok=True)

    base_idle = Image.open(BODY_IDLE_00).convert("RGBA") if os.path.exists(BODY_IDLE_00) else None

    print(f"\n🎭 Processing Face Emotion: '{emotion_name}' (4 frames) -> {out_dir}")

    for idx in range(num_frames):
        cell = transparent_img.crop((idx * cell_w, 0, (idx + 1) * cell_w, h))
        cleaned_cell = isolate_cell_features(cell, is_face=True)

        alpha = np.array(cleaned_cell)[:, :, 3]
        nz_y, nz_x = np.where(alpha > 25)

        final_canvas = Image.new("RGBA", (512, 512), (0, 0, 0, 0))

        if len(nz_y) > 0:
            xmin, xmax = nz_x.min(), nz_x.max()
            ymin, ymax = nz_y.min(), nz_y.max()
            cw = xmax - xmin + 1
            ch = ymax - ymin + 1

            cropped_features = cleaned_cell.crop((xmin, ymin, xmax + 1, ymax + 1))

            fit_scale = TARGET_FACE_WIDTH / max(cw, 1)
            new_w = int(cw * fit_scale)
            new_h = int(ch * fit_scale)

            if new_h > TARGET_FACE_MAX_HEIGHT:
                fit_scale = TARGET_FACE_MAX_HEIGHT / max(ch, 1)
                new_w = int(cw * fit_scale)
                new_h = int(ch * fit_scale)

            resized = cropped_features.resize((max(1, new_w), max(1, new_h)), RESAMPLE_LANCZOS)

            pos_x = TARGET_FACE_CENTER_X - (new_w // 2)
            pos_y = TARGET_FACE_CENTER_Y - (new_h // 2)

            final_canvas.paste(resized, (pos_x, pos_y), resized)

        filename = f"face_{emotion_name}_{idx:02d}.png"
        filepath = os.path.join(out_dir, filename)
        final_canvas.save(filepath, "PNG")
        bbox = final_canvas.getbbox()
        print(f"   ✓ Saved {filename}: size={final_canvas.size}, bbox={bbox}")

        if base_idle and idx == 0:
            comp = Image.alpha_composite(base_idle, final_canvas)
            preview_path = os.path.join(PREVIEW_DIR, f"composite_idle00_{emotion_name}.png")
            comp.save(preview_path, "PNG")
            print(f"   🖼️ Preview composite saved: {preview_path}")


def process_body_strip(transparent_img: Image.Image, pose_name: str):
    """
    Slices a 1x4 horizontal body sheet, aligns feet to baseline Y=460,
    and centers on 512x512 PNG-32 canvas.
    """
    w, h = transparent_img.size
    num_frames = 4
    cell_w = w // num_frames
    out_dir = os.path.join(SPRITES_ROOT, "body", pose_name)
    os.makedirs(out_dir, exist_ok=True)

    print(f"\n🏃 Processing Body Pose: '{pose_name}' (4 frames) -> {out_dir}")

    for idx in range(num_frames):
        cell = transparent_img.crop((idx * cell_w, 0, (idx + 1) * cell_w, h))
        cleaned_cell = isolate_cell_features(cell, is_face=False)

        alpha = np.array(cleaned_cell)[:, :, 3]
        nz_y, nz_x = np.where(alpha > 25)

        final_canvas = Image.new("RGBA", (512, 512), (0, 0, 0, 0))

        if len(nz_y) > 0:
            xmin, xmax = nz_x.min(), nz_x.max()
            ymin, ymax = nz_y.min(), nz_y.max()
            cw = xmax - xmin + 1
            ch = ymax - ymin + 1

            cropped_body = cleaned_cell.crop((xmin, ymin, xmax + 1, ymax + 1))

            scale = min(TARGET_BODY_HEIGHT / max(ch, 1), 512.0 / max(cw, 1))
            if ch < 300:
                scale = 1.0

            new_w = int(cw * scale)
            new_h = int(ch * scale)
            resized = cropped_body.resize((max(1, new_w), max(1, new_h)), RESAMPLE_LANCZOS)

            pos_x = TARGET_BODY_CENTER_X - (new_w // 2)
            pos_y = TARGET_BODY_BASELINE_Y - new_h

            final_canvas.paste(resized, (pos_x, pos_y), resized)

        filename = f"body_{pose_name}_{idx:02d}.png"
        filepath = os.path.join(out_dir, filename)
        final_canvas.save(filepath, "PNG")
        bbox = final_canvas.getbbox()
        print(f"   ✓ Saved {filename}: size={final_canvas.size}, bbox={bbox}")


def process_image_file(file_path: str, debug: bool = False):
    basename = os.path.basename(file_path)
    stem, _ = os.path.splitext(basename)

    print(f"\n📂 Processing Gemini File: {basename}")
    raw_img = Image.open(file_path)
    
    debug_dir = os.path.join(GEMINI_DIR, "debug", stem) if debug else None
    transparent_img = remove_chroma_key(
        img=raw_img,
        hard_threshold=30.0,
        soft_threshold=90.0,
        despill_strength=0.75,
        edge_erode=0.0,
        edge_feather=0.6,
        debug_dir=debug_dir,
        base_name=stem
    )

    trans_path = os.path.join(GEMINI_DIR, f"transparent_{stem}.png")
    transparent_img.save(trans_path, "PNG")
    print(f"✨ Transparent master saved: {trans_path}")

    name_clean = stem.replace("face_", "").replace("body_", "").lower()

    if stem.startswith("face_") or any(e in stem for e in ("curious", "dizzy", "surprised", "blush", "winking", "pout", "happy", "sad", "angry")):
        process_face_strip(transparent_img, name_clean)
    elif stem.startswith("body_") or any(p in stem for p in ("sit", "stand", "lie", "run", "fall", "crash", "recover")):
        process_body_strip(transparent_img, name_clean)
    else:
        process_face_strip(transparent_img, name_clean)


def main():
    parser = argparse.ArgumentParser(description="Remove background and process Gemini sprites.")
    parser.add_argument("--file", help="Specific file to process in generated_images/gemini/")
    parser.add_argument("--debug", action="store_true", help="Export debug passes and composite tests")
    args = parser.parse_args()

    if args.file:
        if os.path.exists(args.file):
            process_image_file(args.file, debug=args.debug)
        else:
            print(f"❌ File not found: {args.file}")
            sys.exit(1)
    else:
        extensions = ("*.jpg", "*.jpeg", "*.png", "*.webp")
        files = []
        for ext in extensions:
            files.extend(glob.glob(os.path.join(GEMINI_DIR, ext)))

        files = [f for f in sorted(files) if not os.path.basename(f).startswith("transparent_")]

        if not files:
            print(f"⚠️ No new image files found in {GEMINI_DIR}")
            return

        print(f"🚀 Found {len(files)} image(s) in {GEMINI_DIR} to process...")
        for f in files:
            process_image_file(f, debug=args.debug)

    print("\n🎉 [process_gemini_sprites] All done!")


if __name__ == "__main__":
    main()
