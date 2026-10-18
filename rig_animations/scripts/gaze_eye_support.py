"""Local edge continuation for gaze r04; never modifies reference or r03."""
import numpy as np
from PIL import Image, ImageFilter


def canvas(source, layer):
    image = Image.new("RGBA", (1024, 1536))
    image.paste(Image.open(source / layer["image"]["path"]),
                (layer["rect"]["left"], layer["rect"]["top"]))
    return image


def lower_envelope(iris):
    """Supported ±8 horizontal / ±5 vertical travel, plus AA/margin reserve."""
    original = np.array(iris.getchannel("A"))
    # Sweep the complete silhouette so the side contour has no horizontal step.
    sweep = np.zeros_like(original)
    for dx in range(-9, 10):
        for dy in range(-6, 7):
            sweep = np.maximum(sweep, np.roll(original, (dy, dx), (0, 1)))
    return np.array(Image.fromarray(sweep).filter(ImageFilter.MaxFilter(3)))


def verify_lower_coverage(source, layout):
    layers = {layer["id"]: layer for layer in layout["layers"]}
    missing = {}
    for side in ["left", "right"]:
        iris = np.array(canvas(source, layers["iris_" + side]).getchannel("A"))
        white = np.array(canvas(source, layers["white_" + side]).getchannel("A"))
        worst = 0
        for dx in [-8, 0, 8]:
            for dy in [-5, 0, 5]:
                shifted = np.roll(iris, (dy, dx), (0, 1))
                shifted[:365] = 0
                worst = max(worst, int(np.count_nonzero((shifted > 128) & (white < 240))))
        missing[side] = worst
    assert not any(missing.values()), f"Lower iris clipped in supported range: {missing}"
    return missing


def extend_support(source, layout):
    layers = {layer["id"]: layer for layer in layout["layers"]}
    report = {}
    for side in ["left", "right"]:
        iris_layer, white_layer = [layers[part + "_" + side] for part in ["iris", "white"]]
        iris = canvas(source, iris_layer)
        white = np.array(canvas(source, white_layer))
        envelope = lower_envelope(iris)
        # Keep the original upper opening; widen the lower sides continuously.
        envelope[:340] = np.minimum(envelope[:340], white[:340, :, 3])
        columns = np.arange(1024)
        for y in range(340, 365):
            old = np.flatnonzero(white[y, :, 3] > 128)
            new = np.flatnonzero(envelope[y] > 128)
            if not len(old) or not len(new):
                continue
            t = (y - 340) / 25
            t = t*t*(3-2*t)
            left = old[0] + (min(old[0], new[0])-old[0])*t
            right = old[-1] + (max(old[-1], new[-1])-old[-1])*t
            coverage = np.clip(np.minimum(columns-left+1, right-columns+1), 0, 1)*255
            envelope[y] = np.minimum(envelope[y], coverage.astype(np.uint8))
        changed = envelope > white[:, :, 3]
        # Continue the existing lower sclera's neutral color into newly exposed support.
        samples = white[370:390]
        color = np.median(samples[:, :, :3][samples[:, :, 3] > 240], axis=0).astype(np.uint8)
        white[changed, :3] = color
        white[changed, 3] = envelope[changed]
        white_image = Image.fromarray(white)
        rect = white_image.getbbox()
        white_image.crop(rect).save(source / white_layer["image"]["path"])
        left, top, right, bottom = rect
        white_layer["rect"] = dict(left=left, top=top, width=right-left, height=bottom-top)
        white_layer["image"].update(width=right-left, height=bottom-top)

        # Repeat the first opaque top-edge color vertically, behind the stationary lash.
        original = np.array(Image.open(source / iris_layer["image"]["path"]).convert("RGBA"))
        extended = np.pad(original, ((8, 0), (0, 0), (0, 0)))
        added = 0
        for x in range(original.shape[1]):
            rows = np.flatnonzero(original[:, x, 3] > 240)
            if not len(rows) or rows[0] > 12:
                continue
            y = int(rows[0]) + 8
            # Do not extrude the captured white sclera fringe into a vertical stripe.
            colors = original[:28, x, :3].astype(np.int16)
            colored = (np.ptp(colors, axis=1) > 30) | (colors.max(axis=1) < 140)
            candidates = np.flatnonzero(colored & (original[:28, x, 3] > 240))
            if not len(candidates):
                continue
            sample = original[int(candidates[0]), x].copy()
            extended[y-8:y, x] = sample
            added += 8
        Image.fromarray(extended).save(source / iris_layer["image"]["path"])
        iris_layer["rect"]["top"] -= 8
        iris_layer["rect"]["height"] += 8
        iris_layer["image"]["height"] += 8
        report[side] = {"sclera_support_pixels": int(changed.sum()), "top_edge_samples": added,
                        "sclera_rgb": color.tolist(), "sclera_rect": white_layer["rect"]}
    report["lower_opaque_pixels_clipped"] = verify_lower_coverage(source, layout)
    return report
