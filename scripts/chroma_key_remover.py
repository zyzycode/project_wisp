#!/usr/bin/env python3
"""
Project Wisp — Professional Chroma Key Remover & Despill Engine
==============================================================
Advanced soft chroma keying, edge despill, and alpha matte generation
for 2D anime/chibi game sprites with green screen background (#00FF00).

Features:
  - Green Dominance & Color Distance Metric (G - max(R, B))
  - Smooth Hermite Alpha Matte (Smoothstep) without harsh thresholding
  - Localized Edge Despill to eliminate green halo/fringing on hair & eyelashes
  - Protection for interior green elements (eyes, bows, clothes) via spatial connectivity
  - Configurable subpixel edge erosion (0-1px) and feathering (0.5-1px)
  - Comprehensive Debug Mode with composite previews on White, Black, Gray backgrounds
  - Batch folder processing (input/*.png -> output/*.png) and single file mode
"""

import os
import sys
import glob
import argparse
from collections import deque
from typing import Tuple, Optional
import numpy as np
from PIL import Image, ImageFilter, ImageOps

# ==============================================================================
# CONFIGURABLE DEFAULT PARAMETERS
# ==============================================================================
DEFAULT_KEY_COLOR = (0, 255, 0)      # Target Chroma Key Color (RGB)
DEFAULT_HARD_THRESHOLD = 30.0        # Above this green excess -> 100% transparent (alpha=0)
DEFAULT_SOFT_THRESHOLD = 90.0        # Below this green excess -> 100% opaque (alpha=255)
DEFAULT_DESPILL_STRENGTH = 0.75      # Strength of green suppression on edge pixels (0.0 - 1.0)
DEFAULT_EDGE_ERODE = 0.0             # Radius for edge erosion in px (0.0 to 1.0)
DEFAULT_EDGE_FEATHER = 0.6           # Gaussian feather radius on edges in px (0.0 to 1.5)


def flood_fill_connected_bg(seed_mask: np.ndarray) -> np.ndarray:
    """
    Finds all background pixels connected to the outer image perimeter via fast 4-way BFS.
    Guarantees that green elements deep inside the character are not marked as background.
    """
    h, w = seed_mask.shape
    visited = np.zeros((h, w), dtype=bool)
    queue = deque()

    # Seed top and bottom borders
    for x in range(w):
        if seed_mask[0, x] and not visited[0, x]:
            visited[0, x] = True
            queue.append((0, x))
        if seed_mask[h - 1, x] and not visited[h - 1, x]:
            visited[h - 1, x] = True
            queue.append((h - 1, x))

    # Seed left and right borders
    for y in range(h):
        if seed_mask[y, 0] and not visited[y, 0]:
            visited[y, 0] = True
            queue.append((y, 0))
        if seed_mask[y, w - 1] and not visited[y, w - 1]:
            visited[y, w - 1] = True
            queue.append((y, w - 1))

    # 4-connected flood fill
    while queue:
        cy, cx = queue.popleft()
        for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
            if 0 <= ny < h and 0 <= nx < w:
                if seed_mask[ny, nx] and not visited[ny, nx]:
                    visited[ny, nx] = True
                    queue.append((ny, nx))

    return visited


def remove_chroma_key(
    img: Image.Image,
    key_color: Tuple[int, int, int] = DEFAULT_KEY_COLOR,
    hard_threshold: float = DEFAULT_HARD_THRESHOLD,
    soft_threshold: float = DEFAULT_SOFT_THRESHOLD,
    despill_strength: float = DEFAULT_DESPILL_STRENGTH,
    edge_erode: float = DEFAULT_EDGE_ERODE,
    edge_feather: float = DEFAULT_EDGE_FEATHER,
    debug_dir: Optional[str] = None,
    base_name: str = "sprite"
) -> Image.Image:
    """
    Executes high-fidelity chroma key removal with soft alpha matte and localized despill.
    
    Returns:
      Clean RGBA PIL.Image.
    """
    img_rgba = img.convert("RGBA")
    arr = np.array(img_rgba, dtype=np.float32)
    h, w, _ = arr.shape
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]

    # --------------------------------------------------------------------------
    # 1. Green Dominance & Distance Metric
    # --------------------------------------------------------------------------
    max_rb = np.maximum(r, b)
    avg_rb = (r + b) * 0.5
    g_excess = g - max_rb

    # Potential background seeds: strong green dominance or outer white/gray frames
    is_green_seed = (g > 70.0) & (g_excess > 10.0)
    is_outer_light_frame = (r > 225.0) & (g > 225.0) & (b > 225.0)
    seed_mask = is_green_seed | is_outer_light_frame

    # Spatial connectivity: flood from borders to identify outer background
    is_connected_bg = flood_fill_connected_bg(seed_mask)

    # --------------------------------------------------------------------------
    # 2. Soft Alpha Calculation (Smoothstep)
    # --------------------------------------------------------------------------
    # t_soft: green excess where pixel begins turning transparent
    # t_hard: green excess where pixel becomes fully transparent
    t_soft = float(hard_threshold)      # e.g., 25-35
    t_hard = float(soft_threshold)      # e.g., 80-100

    # Normalized position in transition ramp
    t = np.clip((g_excess - t_soft) / max(t_hard - t_soft, 1e-5), 0.0, 1.0)
    
    # Smoothstep curve for natural anti-aliased edge falloff
    smooth_alpha = 1.0 - (t * t * (3.0 - 2.0 * t))

    # Opaque foreground protection: only apply transparency to pixels connected to background
    alpha_matte = np.where(is_connected_bg, smooth_alpha, 1.0)

    # Also ensure completely pure green background connected regions are strictly 0.0
    pure_bg = is_connected_bg & (g_excess >= (t_hard - 5.0))
    alpha_matte[pure_bg] = 0.0

    # --------------------------------------------------------------------------
    # 3. Optional Subpixel Edge Erosion & Feathering
    # --------------------------------------------------------------------------
    alpha_img = Image.fromarray(np.uint8(np.clip(alpha_matte * 255.0, 0, 255)), mode="L")

    if edge_erode > 0.0:
        # Subtle 1px erosion using MinFilter(3)
        eroded = alpha_img.filter(ImageFilter.MinFilter(3))
        # Blend eroded with original based on edge_erode strength
        alpha_img = Image.blend(alpha_img, eroded, min(edge_erode, 1.0))

    if edge_feather > 0.0:
        # Gentle Gaussian feathering to guarantee subpixel anti-aliasing
        alpha_img = alpha_img.filter(ImageFilter.GaussianBlur(radius=edge_feather))

    final_alpha = np.array(alpha_img, dtype=np.float32) / 255.0

    # --------------------------------------------------------------------------
    # 4. Localized Despill (Edge-Only Green Suppression)
    # --------------------------------------------------------------------------
    # Target green calculation: blend of max(R, B) and avg(R, B) to match character tones
    target_g = 0.5 * max_rb + 0.5 * avg_rb
    green_spill = np.maximum(0.0, g - target_g)
    despilled_g = g - (despill_strength * green_spill)

    # Apply despill ONLY where green is excessive AND pixel is near an edge (alpha < 0.99)
    # This leaves internal green elements (eyes, green clothes) 100% untouched.
    edge_despill_mask = (final_alpha < 0.99) & (g_excess > 0.0)
    arr[:, :, 1] = np.where(edge_despill_mask, despilled_g, g)

    # Luminance preservation on fine dark line art (eyelashes, dark hair)
    # Restores slight contrast loss from despill on dark outlines
    luma_orig = 0.2126 * r + 0.7152 * g + 0.0722 * b
    luma_new = 0.2126 * arr[:, :, 0] + 0.7152 * arr[:, :, 1] + 0.0722 * arr[:, :, 2]
    luma_diff = np.maximum(0.0, luma_orig - luma_new)
    
    arr[:, :, 0] = np.clip(arr[:, :, 0] + luma_diff * 0.5, 0, 255)
    arr[:, :, 2] = np.clip(arr[:, :, 2] + luma_diff * 0.5, 0, 255)

    arr[:, :, 3] = final_alpha * 255.0
    final_rgba = Image.fromarray(np.uint8(np.clip(arr, 0, 255)), "RGBA")

    # --------------------------------------------------------------------------
    # 5. Debug Mode Export (if requested)
    # --------------------------------------------------------------------------
    if debug_dir:
        os.makedirs(debug_dir, exist_ok=True)
        img_rgba.save(os.path.join(debug_dir, f"{base_name}_01_original.png"), "PNG")
        alpha_img.save(os.path.join(debug_dir, f"{base_name}_02_alpha_mask.png"), "PNG")
        
        # Despilled RGB visualization (full opacity)
        despilled_rgb = Image.fromarray(np.uint8(np.clip(arr[:, :, :3], 0, 255)), "RGB")
        despilled_rgb.save(os.path.join(debug_dir, f"{base_name}_03_despilled_rgb.png"), "PNG")

        # Test composites over White, Black, and Gray backgrounds
        white_bg = Image.new("RGBA", final_rgba.size, (255, 255, 255, 255))
        Image.alpha_composite(white_bg, final_rgba).save(
            os.path.join(debug_dir, f"{base_name}_04_composite_white.png"), "PNG"
        )

        black_bg = Image.new("RGBA", final_rgba.size, (0, 0, 0, 255))
        Image.alpha_composite(black_bg, final_rgba).save(
            os.path.join(debug_dir, f"{base_name}_05_composite_black.png"), "PNG"
        )

        gray_bg = Image.new("RGBA", final_rgba.size, (128, 128, 128, 255))
        Image.alpha_composite(gray_bg, final_rgba).save(
            os.path.join(debug_dir, f"{base_name}_06_composite_gray.png"), "PNG"
        )

        final_rgba.save(os.path.join(debug_dir, f"{base_name}_07_final.png"), "PNG")
        print(f"   🔍 Debug passes saved in: {debug_dir}")

    return final_rgba


def process_path(
    input_path: str,
    output_path: str,
    hard_thresh: float,
    soft_thresh: float,
    despill: float,
    erode: float,
    feather: float,
    debug: bool
):
    """
    Processes a single image file or a directory of images.
    """
    valid_exts = (".png", ".jpg", ".jpeg", ".webp", ".bmp")

    if os.path.isfile(input_path):
        files = [input_path]
        is_single = True
    elif os.path.isdir(input_path):
        files = []
        for ext in valid_exts:
            files.extend(glob.glob(os.path.join(input_path, f"*{ext}")))
        files = sorted(files)
        is_single = False
    else:
        print(f"❌ Error: Input path '{input_path}' does not exist.")
        sys.exit(1)

    if not files:
        print(f"⚠️ No image files found in '{input_path}'.")
        return

    print(f"🚀 Processing {len(files)} image(s)...")
    print(f"   Params: hard_thresh={hard_thresh}, soft_thresh={soft_thresh}, despill={despill}, erode={erode}, feather={feather}")

    for idx, fpath in enumerate(files):
        fname = os.path.basename(fpath)
        stem, _ = os.path.splitext(fname)

        if is_single:
            # If output_path has .png extension, use it directly, otherwise treat as directory
            if output_path.lower().endswith(".png"):
                out_file = output_path
                out_debug_dir = os.path.dirname(output_path) if debug else None
            else:
                os.makedirs(output_path, exist_ok=True)
                out_file = os.path.join(output_path, f"{stem}.png")
                out_debug_dir = os.path.join(output_path, "debug", stem) if debug else None
        else:
            os.makedirs(output_path, exist_ok=True)
            out_file = os.path.join(output_path, f"{stem}.png")
            out_debug_dir = os.path.join(output_path, "debug", stem) if debug else None

        print(f"\n[{idx + 1}/{len(files)}] Removing green screen: {fname} -> {os.path.basename(out_file)}")
        img = Image.open(fpath)
        result = remove_chroma_key(
            img=img,
            hard_threshold=hard_thresh,
            soft_threshold=soft_thresh,
            despill_strength=despill,
            edge_erode=erode,
            edge_feather=feather,
            debug_dir=out_debug_dir,
            base_name=stem
        )

        os.makedirs(os.path.dirname(out_file), exist_ok=True)
        result.save(out_file, "PNG")
        print(f"   ✓ Saved clean RGBA PNG: {out_file} (size={result.size})")

    print("\n🎉 All images processed successfully!")


def main():
    parser = argparse.ArgumentParser(
        description="Professional Chroma Key (#00FF00) Background Remover & Despill Tool for 2D Sprites"
    )
    parser.add_argument(
        "--input", "-i",
        default="generated_images/gemini",
        help="Input image file or folder path (default: generated_images/gemini)"
    )
    parser.add_argument(
        "--output", "-o",
        default="generated_images/gemini/transparent",
        help="Output PNG file or folder path (default: generated_images/gemini/transparent)"
    )
    parser.add_argument(
        "--hard-thresh",
        type=float,
        default=DEFAULT_HARD_THRESHOLD,
        help=f"Hard threshold for green dominance where alpha starts to fall (default: {DEFAULT_HARD_THRESHOLD})"
    )
    parser.add_argument(
        "--soft-thresh",
        type=float,
        default=DEFAULT_SOFT_THRESHOLD,
        help=f"Soft threshold for green dominance where alpha reaches 0 (default: {DEFAULT_SOFT_THRESHOLD})"
    )
    parser.add_argument(
        "--despill",
        type=float,
        default=DEFAULT_DESPILL_STRENGTH,
        help=f"Despill suppression strength 0.0-1.0 (default: {DEFAULT_DESPILL_STRENGTH})"
    )
    parser.add_argument(
        "--erode",
        type=float,
        default=DEFAULT_EDGE_ERODE,
        help=f"Subpixel edge erosion 0.0-1.0 px (default: {DEFAULT_EDGE_ERODE})"
    )
    parser.add_argument(
        "--feather",
        type=float,
        default=DEFAULT_EDGE_FEATHER,
        help=f"Edge feather radius 0.0-1.5 px (default: {DEFAULT_EDGE_FEATHER})"
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Enable debug mode: export alpha mask, despilled RGB, and composite tests (White/Black/Gray)"
    )

    args = parser.parse_args()
    process_path(
        input_path=args.input,
        output_path=args.output,
        hard_thresh=args.hard_thresh,
        soft_thresh=args.soft_thresh,
        despill=args.despill,
        erode=args.erode,
        feather=args.feather,
        debug=args.debug
    )


if __name__ == "__main__":
    main()
