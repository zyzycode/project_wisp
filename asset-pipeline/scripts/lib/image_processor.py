"""
Project Wisp — Sprite Image Transformations & 512x512 Canvas Centering
======================================================================
Rescaling (Lanczos), baseline alignment (Y=460), torso X-centering (X=256),
and face overlay positioning on the character's head.
"""

from typing import List, Optional
import numpy as np
from PIL import Image

from .config import (
    TARGET_CANVAS_SIZE,
    TARGET_BASELINE_Y,
    TARGET_BODY_HEIGHT,
    TARGET_FACE_WIDTH,
    TARGET_FACE_MAX_HEIGHT,
    TARGET_FACE_CENTER_X,
    TARGET_FACE_CENTER_Y,
)

try:
    RESAMPLE_FILTER = Image.Resampling.LANCZOS
except AttributeError:
    RESAMPLE_FILTER = Image.LANCZOS


def calculate_character_anchor(cropped_img: Image.Image) -> float:
    """Calculates weighted center of torso mass along the X axis."""
    arr = np.array(cropped_img)
    if arr.shape[2] < 4:
        return float(cropped_img.size[0] / 2.0)

    alpha = arr[:, :, 3]
    h, w = alpha.shape

    y_min = int(h * 0.15)
    y_max = int(h * 0.75)
    core_alpha = alpha[y_min:y_max, :]

    weights = (core_alpha.astype(float) / 255.0) ** 2
    if np.sum(weights) > 50:
        y_indices, x_indices = np.where(core_alpha > 50)
        if len(x_indices) > 0:
            core_weights = weights[y_indices, x_indices]
            if np.sum(core_weights) > 0:
                return float(np.average(x_indices, weights=core_weights))

    return float(w / 2.0)


def get_reference_scale(current_frames: List[Image.Image], category: str) -> float:
    """Computes uniform scaling factor across all animation frames."""
    max_h = 1
    for frame in current_frames:
        bbox = frame.getbbox()
        if bbox:
            max_h = max(max_h, bbox[3] - bbox[1])

    desired_h = TARGET_BODY_HEIGHT if "body" in category else 420
    scale = desired_h / max(max_h, 1)
    return scale


def crop_and_center_to_512(
    frame_img: Image.Image,
    target_size: int = TARGET_CANVAS_SIZE,
    category: str = "body",
    baseline_y: int = TARGET_BASELINE_Y,
    scale: Optional[float] = None,
) -> Image.Image:
    """
    Fits and places a sliced frame onto a clean 512x512 canvas:
    - Faces/Pupils: centered at head coordinates (X=256, Y=180).
    - Body: grounded at floor baseline (Y=460), torso centered at X=256.
    - Props/FX: centered in canvas.
    """
    canvas = Image.new("RGBA", (target_size, target_size), (0, 0, 0, 0))

    if "faces" in category:
        bbox = frame_img.getbbox()
        if not bbox:
            return canvas
        cropped = frame_img.crop(bbox)
        cw, ch = cropped.size

        # Fit scale according to canonical face box
        fit_scale = TARGET_FACE_WIDTH / max(cw, 1)
        if (ch * fit_scale) > TARGET_FACE_MAX_HEIGHT:
            fit_scale = min(fit_scale, TARGET_FACE_MAX_HEIGHT / max(ch, 1))

        new_w = max(1, int(round(cw * fit_scale)))
        new_h = max(1, int(round(ch * fit_scale)))
        resized = cropped.resize((new_w, new_h), RESAMPLE_FILTER)

        pos_x = TARGET_FACE_CENTER_X - (new_w // 2)
        pos_y = TARGET_FACE_CENTER_Y - (new_h // 2)
        canvas.paste(resized, (pos_x, pos_y), resized)
        return canvas

    elif "props" in category:
        bbox = frame_img.getbbox()
        if not bbox:
            return canvas
        cropped = frame_img.crop(bbox)
        cw, ch = cropped.size
        fit_scale = min((target_size - 40) / max(cw, 1), (target_size - 40) / max(ch, 1))
        new_w = max(1, int(cw * fit_scale))
        new_h = max(1, int(ch * fit_scale))
        resized = cropped.resize((new_w, new_h), RESAMPLE_FILTER)
        pos_x = (target_size - new_w) // 2
        pos_y = (target_size - new_h) // 2
        canvas.paste(resized, (pos_x, pos_y), resized)
        return canvas

    else:
        bbox = frame_img.getbbox()
        if not bbox:
            return canvas

        cropped = frame_img.crop(bbox)
        cw, ch = cropped.size

        if scale is None:
            desired_h = TARGET_BODY_HEIGHT
            scale = desired_h / max(ch, 1)

        new_w = max(1, int(cw * scale))
        new_h = max(1, int(ch * scale))

        if new_w > (target_size - 32):
            scale_w = (target_size - 32) / new_w
            new_w = int(new_w * scale_w)
            new_h = int(new_h * scale_w)

        if new_h > (target_size - 32):
            scale_h = (target_size - 32) / new_h
            new_w = int(new_w * scale_h)
            new_h = int(new_h * scale_h)

        resized = cropped.resize((new_w, new_h), RESAMPLE_FILTER)

        torso_anchor_x = calculate_character_anchor(cropped) * (new_w / max(cw, 1))
        target_center_x = target_size // 2
        pos_x = int(target_center_x - torso_anchor_x)
        pos_x = max(8, min(target_size - new_w - 8, pos_x))

        pos_y = baseline_y - new_h
        if pos_y < 8:
            pos_y = 8
        elif pos_y > target_size - new_h - 8:
            pos_y = target_size - new_h - 8

        canvas.paste(resized, (pos_x, pos_y), resized)
        return canvas
