"""Check the reproduced wrist step and preservation of unaffected textures."""
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OLD = ROOT / "work/arm-01/r11-layers"
NEW = ROOT / "work/arm-01/r12-wrist"


def contour_steps(path):
    alpha = np.array(Image.open(path).convert("RGBA"))[:, :, 3]
    assert alpha.shape == (480, 520)
    edges = []
    for y in range(128, 145):
        xs = np.flatnonzero(alpha[(y-108)*8] >= 128)
        edges.append([xs[0]/8, xs[-1]/8])
    return np.max(np.abs(np.diff(edges, axis=0)), axis=0)


before = contour_steps(OLD / "wrist-after.png")
after = contour_steps(NEW / "wrist-after.png")
assert before[1] >= 0.9, "Regression fixture no longer reproduces the right-edge step"
assert after[1] <= 0.375, "Right wrist edge still has a step"
assert after[0] <= 0.5, "Left wrist edge has a step"
assert (OLD / "native/hand_L.png").read_bytes() == (NEW / "native/hand_L.png").read_bytes()
old_arm = np.array(Image.open(OLD / "native/forearm_L.png").convert("RGBA"))
new_arm = np.array(Image.open(NEW / "native/forearm_L.png").convert("RGBA"))
assert np.array_equal(old_arm[60:], new_arm[60:]), "Distal forearm/elbow changed"
accepted = json.loads((ROOT / "reviews/gaze-01-r08-acceptance.json").read_text())["sha256"]
for name, expected in accepted.items():
    assert hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == expected
result = {"before_max_edge_step_px": before.tolist(), "after_max_edge_step_px": after.tolist(),
          "scope": "50% alpha contour, source rows 128..144; numerical regression, not visual acceptance",
          "hand_unchanged": True, "forearm_below_canvas_y175_unchanged": True,
          "accepted_gaze_and_source_unchanged": True}
(NEW / "contour-verification.json").write_text(json.dumps(result, indent=2)+"\n")
print("PASS: reproduced old step; new contour limits, hand/elbow/source/gaze preservation")
