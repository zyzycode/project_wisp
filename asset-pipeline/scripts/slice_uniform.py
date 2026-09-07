"""Slice an explicitly arranged body strip without SciPy; preserve source alpha."""
import argparse
import os
import re
from collections import deque

from PIL import Image
import numpy as np

from lib.config import SPRITES_DIR
from lib.output_paths import prepare_sprite_file


def isolate_characters(sheet, count):
    """Select substantial connected silhouettes, ordered left to right."""
    data = np.asarray(sheet)
    remaining = data[:, :, 3] > 25
    height, width = remaining.shape
    components = []
    for sy, sx in zip(*np.nonzero(remaining)):
        if not remaining[sy, sx]:
            continue
        queue = deque([(int(sx), int(sy))])
        remaining[sy, sx] = False
        pixels = []
        while queue:
            x, y = queue.popleft()
            pixels.append((x, y))
            for nx, ny in ((x-1,y), (x+1,y), (x,y-1), (x,y+1)):
                if 0 <= nx < width and 0 <= ny < height and remaining[ny, nx]:
                    remaining[ny, nx] = False
                    queue.append((nx, ny))
        if len(pixels) > 1500:
            components.append(pixels)
    if len(components) != count:
        raise ValueError(f"Expected {count} separate silhouettes, found {len(components)}")
    components.sort(key=lambda pixels: sum(p[0] for p in pixels) / len(pixels))
    cells = []
    for pixels in components:
        xs, ys = np.array(pixels).T
        left, right, top, bottom = xs.min(), xs.max()+1, ys.min(), ys.max()+1
        cell = np.zeros((bottom-top, right-left, 4), dtype=np.uint8)
        cell[ys-top, xs-left] = data[ys, xs]
        cells.append(Image.fromarray(cell))
    return cells


def slice_strip(source, key, count=4, components=False, replace=False):
    if not re.fullmatch(r"body_[a-z0-9_]+", key) or count < 4:
        raise ValueError("Expected body snake_case key and at least four frames")
    with Image.open(source) as original:
        if original.mode != "RGBA" or original.getchannel("A").getextrema()[0] != 0:
            raise ValueError("Source must have genuine transparent RGBA pixels")
        sheet = original.copy()
    width, height = sheet.size
    cells = [sheet.crop((round(i * width / count), 0,
                         round((i + 1) * width / count), height)) for i in range(count)]
    if components:
        cells = isolate_characters(sheet, count)
    boxes = [cell.getbbox() for cell in cells]
    if any(box is None for box in boxes):
        raise ValueError("Empty frame")
    # One common transform preserves the generated motion and root placement.
    top = min(box[1] for box in boxes)
    bottom = max(box[3] for box in boxes)
    scale = min(390 / (bottom - top), 480 / max(cell.width for cell in cells))
    paths = []
    for index, cell in enumerate(cells):
        cropped = cell.crop((0, top, cell.width, bottom))
        resized = cropped.resize((round(cropped.width * scale), round(cropped.height * scale)),
                                 Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (512, 512))
        canvas.alpha_composite(resized, ((512 - resized.width) // 2, 460 - resized.height))
        target = os.path.join(SPRITES_DIR, "body", key.removeprefix("body_"),
                              f"{key}_{index:02d}.png")
        if os.path.exists(target) and not replace:
            raise ValueError(f"Refusing to replace existing sprite: {target}")
        paths.append((target, canvas))
    for target, canvas in paths:
        canvas.save(prepare_sprite_file(target, sources=[source]))
    return [target for target, _ in paths]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", required=True)
    parser.add_argument("--key", required=True)
    parser.add_argument("--components", action="store_true")
    parser.add_argument("--replace", action="store_true")
    args = parser.parse_args()
    for path in slice_strip(args.file, args.key, components=args.components, replace=args.replace):
        print(path)
