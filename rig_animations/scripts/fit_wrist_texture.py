"""Fit wrist silhouette by a local horizontal texture deformation, not painting."""
import json
from pathlib import Path
import shutil
import subprocess

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "work/arm-01/r12-wrist"
SOURCE = ROOT / "work/arm-01/r11-layers/native"


def edges(alpha, y):
    row = alpha[y].astype(float) / 255
    inside = np.flatnonzero(row >= 0.5)
    a, b = int(inside[0]), int(inside[-1])
    left = a - 1 + (0.5 - row[a - 1]) / (row[a] - row[a - 1])
    right = b + (row[b] - 0.5) / (row[b] - row[b + 1])
    return np.array([left, right])


def main():
    native = OUT / "native"
    native.mkdir(parents=True, exist_ok=True)
    hand = np.array(Image.open(SOURCE / "hand_L-unmasked.png"))[:, :, 3]
    arm = np.array(Image.open(SOURCE / "forearm_L.png"))[:, :, 3]
    # Both textures keep the r11 layout coordinates. Only the proximal 60 rows
    # of the forearm are resampled; palm, fingers and elbow stay unchanged.
    rows = 61
    source = np.array([edges(arm, max(4, y)) for y in range(rows)])
    target = source.copy()
    start = edges(hand, 130) + 104 - 64
    slope = (edges(hand, 130) - edges(hand, 126)) / 4
    end = source[60]
    end_slope = (source[60] - source[56]) / 4
    for y in range(rows):
        if y <= 25:
            target[y] = edges(hand, y + 105) + 40
        else:
            t = (y - 25) / 35
            target[y] = ((2*t**3-3*t*t+1)*start + (t**3-2*t*t+t)*35*slope
                         + (-2*t**3+3*t*t)*end + (t**3-t*t)*35*end_slope)
    # A 16-bit numeric coordinate table; it contains no artwork.
    table = np.concatenate([source, target], axis=1)
    table = np.vstack([table, np.tile(table[-1], (arm.shape[0]-rows, 1))])
    data = np.rint(table / 128 * 65535).astype(">u2")
    mapping = OUT / "coordinates.pam"
    header = f"P7\nWIDTH 1\nHEIGHT {arm.shape[0]}\nDEPTH 4\nMAXVAL 65535\nTUPLTYPE RGB_ALPHA\nENDHDR\n"
    mapping.write_bytes(header.encode()+data.tobytes())
    expr = ("sl=v.p{0,j}.r*128;sr=v.p{0,j}.g*128;dl=v.p{0,j}.b*128;dr=v.p{0,j}.a*128;"
            "j<60?u.p{sl+(i-dl)*(sr-sl)/(dr-dl),j}:u")
    subprocess.run(["convert", str(SOURCE / "forearm_L.png"), str(mapping), "-virtual-pixel", "transparent",
                    "-interpolate", "bilinear", "-channel", "RGBA", "-fx", expr,
                    str(OUT / "warped-unclipped.png")], check=True)
    clip = ("dl=v.p{0,j}.b*128;dr=v.p{0,j}.a*128;"
            "j<60?min(u,max(0,min(1,i-dl+0.5))*max(0,min(1,dr-i+0.5))):u")
    subprocess.run(["convert", str(OUT / "warped-unclipped.png"), str(mapping),
                    "-channel", "A", "-fx", clip, "+channel", str(native / "forearm_L.png")], check=True)
    shutil.copy2(SOURCE / "hand_L.png", native / "hand_L.png")
    (OUT / "texture-fit.json").write_text(json.dumps({
        "method": "Local per-row horizontal deformation via ImageMagick bilinear resampling",
        "canonical_edge": "r11 unmasked hand 50% alpha contour", "source": str(SOURCE),
        "forearm_placement": [64, 115], "hand_placement": [104, 10],
        "source_edge_rows": source.tolist(), "target_edge_rows": target.tolist(),
        "full_edge_match_until_canvas_y": 140, "hermite_return_to_original_canvas_y": 175,
        "hand_texture_unchanged": True, "new_artwork": False,
        "note": "Local width deformation is intentional and recorded; not uniform size normalization"
    }, indent=2)+"\n")
    print("Prepared locally fitted wrist texture; visual inspection required")


if __name__ == "__main__":
    main()
