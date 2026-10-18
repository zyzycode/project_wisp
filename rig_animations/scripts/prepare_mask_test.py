"""Reproducible, non-generative iris mask trial, not a finished facial rig."""
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "work/mask-test"
EXPECTED = "f0c3a98fc8876b3aebbaf9804db8ccd611c2465c6bca49d0171e7bff7fd13cb7"
# Canvas pixels, polygon outlines for visible irises; side is the character's.
POLYGONS = {
    "iris_right": [(426,324),(441,324),(454,327),(465,331),(469,342),
                   (470,355),(467,369),(460,380),(449,387),(438,388),
                   (428,382),(421,372),(417,358),(417,344),(420,333)],
    "iris_left": [(570,329),(583,325),(599,324),(610,324),(615,336),
                  (618,349),(617,360),(612,374),(605,383),(593,388),
                  (580,385),(570,376),(564,363),(562,351),(564,338)],
}


def main():
    source = ROOT / "character_reference.png"
    assert hashlib.sha256(source.read_bytes()).hexdigest() == EXPECTED
    original = Image.open(source).convert("RGBA")
    pixels = np.array(original)
    OUT.mkdir(parents=True, exist_ok=True)
    union = np.zeros(pixels.shape[:2], dtype=bool)
    pieces = []
    manifest_layers = []
    overlay = original.copy()
    for name, points in POLYGONS.items():
        mask = Image.new("L", original.size)
        ImageDraw.Draw(mask).polygon(points, fill=255)
        selected = np.array(mask) != 0
        assert not np.any(selected & union)
        union |= selected
        part = pixels.copy()
        part[~selected] = 0
        piece = Image.fromarray(part)
        pieces.append(piece)
        bounds = mask.getbbox()
        cropped = piece.crop(bounds)
        cropped.save(OUT / f"{name}.png")
        mask.save(OUT / f"{name}.mask.png")
        manifest_layers.append({"id": name, "name": name,
            "image": {"path": f"{name}.png", "width": cropped.width, "height": cropped.height},
            "rect": {"left": bounds[0], "top": bounds[1],
                     "width": cropped.width, "height": cropped.height},
            "tags": ["eye", "iris", name.split("_")[1]]})
        ImageDraw.Draw(overlay).line(points + [points[0]], fill=(255,0,120,255), width=1)
    remainder = pixels.copy()
    remainder[union] = 0
    base = Image.fromarray(remainder)
    base.save(OUT / "remainder.png")
    reconstructed = base.copy()
    for piece in pieces:
        reconstructed = Image.alpha_composite(reconstructed, piece)
    actual = np.array(reconstructed)
    # RGB under zero alpha is invisible and is deliberately excluded.
    visible = (pixels[:,:,3] != 0) | (actual[:,:,3] != 0)
    delta = np.abs(actual.astype(np.int16) - pixels.astype(np.int16))
    max_visible_error = int(delta[visible].max())
    assert max_visible_error == 0
    assert np.array_equal(actual[:,:,3], pixels[:,:,3])
    reconstructed.save(OUT / "neutral.png")
    overlay.crop((365,300,665,400)).resize((1200,400)).save(OUT / "mask-boundaries.png")
    manifest_layers.insert(0, {"id":"remainder", "name":"remainder",
        "image":{"path":"remainder.png","width":original.width,"height":original.height},
        "rect":{"left":0,"top":0,"width":original.width,"height":original.height}})
    manifest = {"format":"psd2live-layout","version":1,"name":"iris-mask-trial",
                "canvas":{"width":original.width,"height":original.height},"layers":manifest_layers}
    (OUT / "layout.json").write_text(json.dumps(manifest, indent=2) + "\n")
    report = {"method":"binary polygon masks over original pixels", "source_sha256":EXPECTED,
              "selected_pixels":int(union.sum()), "max_visible_rgba_error":max_visible_error,
              "alpha_identical":True, "parts":list(POLYGONS),
              "limitations":["rough visible-only contours, no hidden sclera",
                              "edge matting and eyelid occlusion still require work",
                              "neutral reconstruction passes; moving irises exposes holes"]}
    (OUT / "verification.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
