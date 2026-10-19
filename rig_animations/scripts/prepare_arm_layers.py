"""Prepare r13 arm candidates from one generated upper arm and source bracelets."""
import json
from pathlib import Path
import shutil
import subprocess

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "work/arm-01/r13-arm"
WRIST = ROOT / "work/arm-01/r12-wrist/native"
BRACELETS = ROOT / "work/arm-01/r13-bracelets"
PLACEMENT = {"upper_arm_L": [110, 270], "forearm_L": [244, 145],
             "hand_L": [284, 40], "bracelet_red_L": [300, 140], "bracelet_blue_L": [298, 150]}


def convert(*args):
    subprocess.run(["convert", *map(str, args)], check=True)


def main():
    native = OUT / "native"
    native.mkdir(exist_ok=True, parents=True)
    convert(OUT / "raw/upper_arm_L.png", "-crop", "1741x659+78+85", "+repage",
            "-resize", "190x", "-bordercolor", "none", "-border", "2",
            native / "upper_arm_L-unrotated.png")
    convert(native / "upper_arm_L-unrotated.png", "-background", "none", "-rotate", "-8",
            "-trim", "+repage", "-bordercolor", "none", "-border", "2", native / "upper_arm_L.png")
    shutil.copy2(WRIST / "hand_L.png", native / "hand_L.png")
    shutil.copy2(WRIST / "forearm_L.png", native / "forearm_L-base.png")
    for name in ["bracelet_blue_L", "bracelet_red_L"]:
        convert(BRACELETS / (name+".png"), "-resize", "72%", "-background", "none",
                "-rotate", "-140", "-trim", "+repage", "-bordercolor", "none", "-border", "2",
                native / (name+".png"))
    # Remove only the internal forearm outline where the opaque upper-arm layer
    # already covers it. Keep its exterior edge and the accepted wrist untouched.
    upper = np.array(Image.open(native / "upper_arm_L.png").convert("RGBA"))[:, :, 3]
    arm = np.array(Image.open(WRIST / "forearm_L.png").convert("RGBA"))[:, :, 3]
    matte = np.full(arm.shape, 255, dtype=np.uint8)
    for y in range(138, arm.shape[0]):
        xs = np.flatnonzero(arm[y] > 128)
        if not len(xs):
            continue
        left, right = xs[0], xs[-1]
        for x in range(max(0, left-2), min(arm.shape[1], left+7)):
            ux, uy = x+244-110, y+145-270
            if x < (left+right)/2 and 0 <= uy < upper.shape[0] and 0 <= ux < upper.shape[1] and upper[uy, ux] >= 250:
                matte[y, x] = round(255*np.clip((x-left-2)/3, 0, 1))
    mask = OUT / "forearm-internal-outline-mask.pgm"
    mask.write_bytes(f"P5\n{arm.shape[1]} {arm.shape[0]}\n255\n".encode()+matte.tobytes())
    convert(native / "forearm_L-base.png", mask, "-channel", "A", "-fx", "u*v.r", "+channel",
            native / "forearm_L.png")
    layers = []
    for name, (x, y) in PLACEMENT.items():
        w, h = Image.open(native / (name+".png")).size
        layers.append({"id": name, "name": name, "image": {"path": "native/"+name+".png", "width": w, "height": h},
                       "rect": {"left": x, "top": y, "width": w, "height": h}, "tags": ["detail"]})
    (OUT / "layout.json").write_text(json.dumps({"format": "psd2live-layout", "version": 1,
        "name": "ARM-01 r13 static arm layer assembly", "canvas": {"width": 440, "height": 380}, "layers": layers}, indent=2)+"\n")
    (OUT / "preparation.json").write_text(json.dumps({"upper_arm": {"crop": [78,85,1741,659],
        "uniform_resize_width": 190, "rotation_degrees": -8, "transparent_border": 2},
        "bracelets": {"source": str(BRACELETS.relative_to(ROOT)), "uniform_scale": .72, "rotation_degrees": -140,
        "order": "red toward hand; blue toward forearm, as original character", "blue_overlap_adjustment": [1,-3]},
        "placement": PLACEMENT, "accepted_wrist_pair_translation": [180,30],
        "forearm_alpha_only_edit": "Internal left elbow outline under fully opaque upper arm, local y>=138; no RGB changes",
        "generation": "one upper-arm image only; bracelets from original pixels"}, indent=2)+"\n")
    cmd = ["-size", "440x380", "xc:none"]
    for name, (x, y) in PLACEMENT.items():
        cmd += [native / (name+".png"), "-geometry", f"+{x}+{y}", "-composite"]
    convert(*cmd, OUT / "prepared.png")
    print("Prepared five static layers; accepted wrist preserved")


if __name__ == "__main__":
    main()
