"""
Project Wisp — Sprite Grid & Object Component Detector
======================================================
Smart segmentation of sprite sheets using connected component analysis (body)
and uniform cell grid extraction (faces, overlays, props).
Standard: 1x4 (4 frames) by default; 2x4 (8 frames) for complex idle loops.
"""

import os
import re
from typing import List, Optional, Tuple

import numpy as np
import scipy.ndimage as ndi
from PIL import Image


def parse_filename_grid_hint(filename: str) -> Optional[Tuple[int, int]]:
    """Extract grid hints like '1x4', '2x3', '1x2', '4frames', '8frames' from filename."""
    base = os.path.splitext(filename)[0].lower()
    m = re.search(r'(\d+)\s*[xX*]\s*(\d+)', base)
    if m:
        r, c = int(m.group(1)), int(m.group(2))
        if 1 <= r <= 8 and 1 <= c <= 12 and r * c <= 36:
            return (r, c)

    m_f = re.search(r'(\d+)\s*(?:frames?|кадр|f\b|_f)', base)
    if m_f:
        total = int(m_f.group(1))
        grid_map = {
            24: (3, 8), 18: (3, 6), 16: (4, 4), 12: (3, 4),
            8: (2, 4), 6: (2, 3), 4: (1, 4), 2: (1, 2), 1: (1, 1)
        }
        if total in grid_map:
            return grid_map[total]

    return None


def detect_grid_dimensions(
    img: Image.Image,
    default_grid: Tuple[int, int] = (1, 4),
    filename: Optional[str] = None,
    is_face_overlay: bool = False
) -> Tuple[int, int]:
    """
    Detects optimal row x column layout for a sprite sheet.
    Defaults to 1x4 (4 frames) according to Project Wisp standards.
    """
    if filename:
        hint = parse_filename_grid_hint(filename)
        if hint:
            return hint

    w, h = img.size
    aspect = w / h

    if is_face_overlay:
        # Standard face overlay sheet is 1x4 (aspect roughly 3.5 - 5.5) or 1x1 single icon
        if 0.8 <= aspect <= 1.25 and default_grid == (1, 1):
            return (1, 1)
        # Default standard for all emotion / overlay packs is 1x4 (4 frames)
        return default_grid if default_grid[0] * default_grid[1] >= 4 else (1, 4)

    if default_grid == (1, 1) and 0.8 <= aspect <= 1.25:
        return (1, 1)

    arr = np.array(img.convert("RGBA"))
    alpha = arr[:, :, 3] if arr.shape[2] == 4 else np.full((h, w), 255, dtype=np.uint8)
    alpha = np.where(alpha < 20, 0, alpha)

    if (alpha > 25).sum() < 500:
        return default_grid

    # Only evaluate standard layouts (minimum 4 frames, except explicit 1x1 props)
    candidates = [
        (1, 4), (1, 6), (1, 8),
        (2, 4), (2, 6), (2, 8),
        (3, 4), (3, 6), (3, 8),
        (4, 4), (4, 6),
    ]

    best_score = -1e9
    best_grid = default_grid

    for r, c in candidates:
        if r * c > 32:
            continue
        row_h = h / r
        col_w = w / c
        cell_aspect = col_w / row_h

        # 1. Check horizontal valleys (rows)
        if r > 1:
            row_density = (alpha > 25).sum(axis=1).astype(float)
            max_rd = max(1.0, float(np.max(row_density)))
            row_valleys = []
            win_y = max(4, int(row_h * 0.12))
            for k in range(1, r):
                nom_y = int(k * row_h)
                y1 = max(0, nom_y - win_y)
                y2 = min(h, nom_y + win_y)
                v = float(np.min(row_density[y1:y2])) / max_rd
                row_valleys.append(v)
            max_row_v = max(row_valleys)
            avg_row_v = float(np.mean(row_valleys))
            if max_row_v > 0.18:
                continue
            row_score = 1.0 - avg_row_v
        else:
            row_score = 0.5

        # 2. Check vertical valleys (columns)
        if c > 1:
            col_density = (alpha > 25).sum(axis=0).astype(float)
            max_cd = max(1.0, float(np.max(col_density)))
            col_valleys = []
            win_x = max(4, int(col_w * 0.12))
            for k in range(1, c):
                nom_x = int(k * col_w)
                x1 = max(0, nom_x - win_x)
                x2 = min(w, nom_x + win_x)
                v = float(np.min(col_density[x1:x2])) / max_cd
                col_valleys.append(v)
            max_col_v = max(col_valleys)
            avg_col_v = float(np.mean(col_valleys))
            if max_col_v > 0.18:
                continue
            col_score = 1.0 - avg_col_v
        else:
            col_score = 0.5

        # 3. Aspect ratio score
        if 0.60 <= cell_aspect <= 1.25:
            aspect_score = 1.5
        elif 0.40 <= cell_aspect <= 1.6:
            aspect_score = 0.5
        else:
            aspect_score = -1.0

        total_score = (row_score * 4.0) + (col_score * 4.0) + aspect_score + (r * c * 0.05)

        if total_score > best_score:
            best_score = total_score
            best_grid = (r, c)

    return best_grid


def extract_frames_from_sheet(
    full_rgba: Image.Image,
    rows: int,
    cols: int,
    is_face_overlay: bool = False
) -> List[Image.Image]:
    """
    Slices individual frames from a sprite sheet.
    - Faces/Overlays: sliced strictly on uniform grid cells (preserves separate eye/brow/mouth components).
    - Body: uses Connected Component Object Island analysis to ensure no limbs or hair are severed.
    """
    w, h = full_rgba.size
    if rows == 1 and cols == 1:
        return [full_rgba]

    arr = np.array(full_rgba.convert("RGBA"))
    alpha = arr[:, :, 3] if arr.shape[2] == 4 else np.full((h, w), 255, dtype=np.uint8)
    clean_a = np.where(alpha < 15, 0, alpha)

    total_expected = rows * cols

    # Uniform pixel cells for faces/overlays
    if is_face_overlay:
        col_w = w / cols
        row_h = h / rows
        frames = []
        for r in range(rows):
            for c in range(cols):
                x1 = int(c * col_w)
                x2 = int((c + 1) * col_w)
                y1 = int(r * row_h)
                y2 = int((r + 1) * row_h)
                cell_arr = arr[y1:y2, x1:x2].copy()
                cell_arr[:, :, 3] = np.where(cell_arr[:, :, 3] < 15, 0, cell_arr[:, :, 3])
                frames.append(Image.fromarray(cell_arr))
        return frames

    # Connected component analysis for character body
    labeled, num_features = ndi.label(clean_a > 0)
    comp_sizes = [(i, (labeled == i).sum()) for i in range(1, num_features + 1)]
    comp_sizes.sort(key=lambda x: x[1], reverse=True)

    major_comps = [c for c in comp_sizes if c[1] > 1500]

    if len(major_comps) >= total_expected and total_expected > 0:
        comps = []
        for comp_id, _ in major_comps[:total_expected]:
            mask = (labeled == comp_id)
            y_idx, x_idx = np.where(mask)
            comps.append({
                "id": comp_id,
                "mask": mask,
                "cx": float(np.mean(x_idx)),
                "cy": float(np.mean(y_idx)),
            })

        row_h = h / rows
        for c in comps:
            c["row"] = min(rows - 1, max(0, int(c["cy"] / row_h)))

        comps.sort(key=lambda c: (c["row"], c["cx"]))

        marker_map = np.zeros((h, w), dtype=int)
        for idx, comp in enumerate(comps, 1):
            marker_map[comp["mask"]] = idx

        _, indices = ndi.distance_transform_edt(marker_map == 0, return_indices=True)
        nearest_comp = marker_map[indices[0], indices[1]]

        frames = []
        for idx, comp in enumerate(comps, 1):
            char_mask = (nearest_comp == idx) & (clean_a > 0)
            y_idx, x_idx = np.where(char_mask)
            if len(y_idx) > 0:
                x1, x2 = x_idx.min(), x_idx.max()
                y1, y2 = y_idx.min(), y_idx.max()
                char_arr = np.zeros((y2 - y1 + 1, x2 - x1 + 1, 4), dtype=np.uint8)
                sub_arr = arr[y1:y2 + 1, x1:x2 + 1]
                sub_mask = char_mask[y1:y2 + 1, x1:x2 + 1]
                char_arr[:, :, :3] = sub_arr[:, :, :3]
                char_arr[:, :, 3] = np.where(sub_mask, sub_arr[:, :, 3], 0)
                frames.append(Image.fromarray(char_arr))
        return frames

    else:
        # Fallback: Valley detection
        col_density = (clean_a > 0).sum(axis=0)
        row_density = (clean_a > 0).sum(axis=1)

        def find_valleys(density, count, total_len):
            step = total_len / count
            cuts = [0]
            for k in range(1, count):
                nom = int(k * step)
                win = max(4, int(step * 0.15))
                p1, p2 = max(0, nom - win), min(total_len, nom + win)
                sub = density[p1:p2]
                cuts.append(p1 + int(np.argmin(sub)) if len(sub) > 0 else nom)
            cuts.append(total_len)
            return cuts

        x_cuts = find_valleys(col_density, cols, w)
        y_cuts = find_valleys(row_density, rows, h)

        frames = []
        for r in range(rows):
            for c in range(cols):
                y1, y2 = y_cuts[r], y_cuts[r + 1]
                x1, x2 = x_cuts[c], x_cuts[c + 1]
                cell = arr[y1:y2, x1:x2].copy()
                cell_a = np.where(cell[:, :, 3] < 15, 0, cell[:, :, 3])
                cell[:, :, 3] = cell_a
                cell_img = Image.fromarray(cell)
                bbox = cell_img.getbbox()
                if bbox:
                    frames.append(cell_img.crop(bbox))
        return frames
