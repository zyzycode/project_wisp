"""Rig accepted r06 PNGs using rigid translation and the unchanged r03 aperture."""
import argparse
from datetime import datetime, timezone
import io
import json
import shutil

import numpy as np
from PIL import Image

from mcp import ROOT, client
from prepare_mask_test import EXPECTED
from prototype_gaze_rigid import checksum, write

REVISION = "r07"
OUT = ROOT / "work/gaze-01" / REVISION
BASE = ROOT / "work/gaze-01/r03"
ART = ROOT / "work/gaze-01/r06-layers/v2/native"
PROJECT = OUT / "gaze-01-r07.psd2live"
X, Y = "ParamGazeX", "ParamGazeY"
LAYERS = ["character_original", "white_right", "iris_right", "lash_right",
          "white_left", "iris_left", "lash_left"]
PLACEMENT = {"neutral_offsets": {"right": [0, -7], "left": [0, -7]},
             "up_px": 4, "down_px": 3, "horizontal_px": 8,
             "reason": "Fit complete iris tips inside unchanged r03 aperture without scale",
             "lower_limit": "Both bottom ten rows fit; right has narrow side overlap above tip",
             "combinations": "Authored for continuity; review uses one axis at a time"}


def backup(c):
    state = c.project()
    assert not state["busy"], "Editor is busy; preserve its current work"
    if state["loaded"]:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        path = OUT / f"workspace-backup-{stamp}.psd2live"
        c.edit("project_save_as", path=str(path))
        assert path.is_file() and path.stat().st_size > 0


def prepare(config):
    assert checksum(ROOT / "character_reference.png") == EXPECTED
    source = OUT / "source"
    source.mkdir(parents=True, exist_ok=True)
    layout = json.loads((BASE / "source/layout.json").read_text())
    layout["name"] = "Wisp accepted generated irises " + REVISION
    for layer in layout["layers"]:
        name = layer["image"]["path"]
        is_iris = layer["id"].startswith("iris_")
        origin = (ART if is_iris else BASE / "source") / name
        shutil.copy2(origin, source / name)
        assert checksum(origin) == checksum(source / name)
        if is_iris:
            side = layer["id"].removeprefix("iris_")
            dx, dy = config["neutral_offsets"][side]
            layer["rect"]["left"] += dx
            layer["rect"]["top"] += dy
        assert Image.open(source / name).size == (layer["image"]["width"], layer["image"]["height"])
    write(source / "layout.json", layout)
    return layout


def render(c, name, x=0, y=0, face=True, include=None):
    rect = (350, 260, 330, 210) if face else (0, 0, 1024, 1536)
    _, images = c.call("view_render_model", {
        "viewport": dict(zip(["left", "top", "width", "height"], rect), mode="canvas_rect"),
        "parameters": {X: x, Y: y}, "target_long_edge": 990 if face else 1536,
        "include_layer_ids": LAYERS if include is None else include})
    assert images
    path = OUT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(images[0])
    return np.array(Image.open(io.BytesIO(images[0])).convert("RGBA"))


def build():
    if PROJECT.exists():
        raise RuntimeError("Existing revision preserved; use verify or a new revision")
    config = PLACEMENT
    OUT.mkdir(parents=True, exist_ok=True)
    write(OUT / "placement.json", config)
    layout = prepare(config)
    with client() as c:
        for op in ["project_save_as", "project_open", "project_import_layout", "settings_update",
                   "layer_mesh_update", "rig_generate", "rig_edit_structure", "author_axis", "view_render_model"]:
            write(OUT / (op + ".schema.json"), c.call("workspace_get_operation", {"id": op})[0])
        backup(c)
        c.edit("project_import_layout", path=str(OUT / "source/layout.json"))
        c.edit("settings_update", changes={"meshOnly": False, "generateDeformers": False,
            "generatePhysics": False, "featureDisplacementEnabled": False, "mouthOutlineEnabled": False,
            "motionBasic": False, "motionIdle": False, "motionBlink": False, "motionNod": False,
            "motionShake": False, "motionSkeleton": False})
        for side in ["right", "left"]:
            c.edit("layer_mesh_update", layer_id="iris_" + side,
                   changes={"outerMargin": 2, "maxEdgeDistance": 6, "interiorDensity": 6})
        c.edit("rig_generate")
        objects = c.call("workspace_inspect", {"scope": "objects", "limit": 64})[0]
        write(OUT / "objects.json", objects)
        meshes = {item["layerId"]: item["target"] for item in objects["items"]
                  if item["target"].startswith("mesh:")}
        c.edit("rig_edit_structure", edits=[{"action": "static", "kind": "mesh",
            "id": meshes["iris_" + side].split(":")[1],
            "masked_by": [meshes["white_" + side].split(":")[1]]} for side in ["right", "left"]])
        dimensions = {p["id"]: (p["rect"]["width"], p["rect"]["height"]) for p in layout["layers"]}
        horizontal = [{"target": meshes["iris_" + side], "value": value,
            "operations": [{"type": "translate", "delta": [value * config["horizontal_px"] / dimensions["iris_" + side][0], 0]}]}
            for side in ["right", "left"] for value in [-1, 1]]
        c.edit("author_axis", parameter={"id": X, "name": "Gaze horizontal", "min": -1, "max": 1, "default": 0}, shapes=horizontal)
        vertical = [{"target": meshes["iris_" + side], "value": value, "key": {X: x},
            "operations": [{"type": "translate", "delta": [0, pixels / dimensions["iris_" + side][1]]}]}
            for side in ["right", "left"] for value, pixels in [(-1, -config["up_px"]), (1, config["down_px"])]
            for x in [-1, 0, 1]]
        c.edit("author_axis", parameter={"id": Y, "name": "Gaze vertical", "min": -1, "max": 1, "default": 0}, shapes=vertical)
        write(OUT / "authored-axes.json", {"horizontal": horizontal, "vertical": vertical})
        c.edit("project_save_as", path=str(PROJECT))
        for name, x, y in [("up", 0, -1), ("neutral", 0, 0), ("down", 0, 1),
                           ("left", -1, 0), ("right", 1, 0)]:
            render(c, f"poses/{name}-face.png", x=x, y=y)
            render(c, f"poses/{name}-full.png", x=x, y=y, face=False)
    print("Built", PROJECT, flush=True)


def verify():
    prior_hash = checksum(BASE / "gaze-01-r03.psd2live")
    accepted_project = ROOT / "work/gaze-01/r07/gaze-01-r07.psd2live"
    accepted_hash = checksum(accepted_project)
    config = json.loads((OUT / "placement.json").read_text())
    source = OUT / "source"
    layout = json.loads((source / "layout.json").read_text())
    prior = {p["id"]: p for p in json.loads((BASE / "source/layout.json").read_text())["layers"]}
    for layer in layout["layers"]:
        origin = ART if layer["id"].startswith("iris_") else BASE / "source"
        assert checksum(source / layer["image"]["path"]) == checksum(origin / layer["image"]["path"])
        if not layer["id"].startswith("iris_"):
            assert layer == prior[layer["id"]]
    with client() as c:
        backup(c)
        c.edit("project_open", path=str(PROJECT))
        poses = [(0, -1), (0, 0), (0, 1), (-1, 0), (1, 0)]
        before = [render(c, f"checks/before-{i}.png", x, y, face=False) for i, (x, y) in enumerate(poses)]
        structure = c.call("workspace_inspect", {"scope": "parameters", "limit": 64})[0]
        c.edit("project_save_as", path=str(PROJECT))
        c.edit("project_open", path=str(PROJECT))
        after = [render(c, f"checks/after-{i}.png", x, y, face=False) for i, (x, y) in enumerate(poses)]
        assert all(np.array_equal(a, b) for a, b in zip(before, after))
        assert structure["items"] == c.call("workspace_inspect", {"scope": "parameters", "limit": 64})[0]["items"]
        assert not np.array_equal(after[0], after[2])
        assert not np.array_equal(after[3], after[4])
        if REVISION == "r08":
            accepted = accepted_project.parent
            for current, path in [(after[1], "poses/neutral-full.png"),
                                  (after[3], "frames/x-full-00.png"),
                                  (after[4], "frames/x-full-20.png")]:
                assert np.array_equal(current, np.array(Image.open(accepted / path).convert("RGBA")))
            for current, name in [(after[0], "up"), (after[2], "down")]:
                assert not np.array_equal(current, np.array(Image.open(accepted / f"poses/{name}-full.png").convert("RGBA")))
        fixed = [name for name in LAYERS if not name.startswith("iris_")]
        fixed_up = render(c, "checks/fixed-up.png", y=-1, face=False, include=fixed)
        fixed_down = render(c, "checks/fixed-down.png", y=1, face=False, include=fixed)
        assert np.array_equal(fixed_up, fixed_down)
        stable = np.ones(after[1].shape[:2], dtype=bool)
        stable[302:401, 370:661] = False
        baseline = np.array(Image.open(BASE / "frames/full-10.png").convert("RGBA"))
        assert all(np.array_equal(a[stable], baseline[stable]) for a in after)
        for axis in ["y", "x"]:
            for i in range(21):
                value = (i - 10) / 10
                x, y = (0, value) if axis == "y" else (value, 0)
                frame = render(c, f"frames/{axis}-full-{i:02}.png", x, y, face=False)
                assert np.array_equal(frame[stable], baseline[stable])
                render(c, f"frames/{axis}-face-{i:02}.png", x, y)
            print("Verified axis", axis, flush=True)
    assert checksum(ROOT / "character_reference.png") == EXPECTED
    assert checksum(BASE / "gaze-01-r03.psd2live") == prior_hash
    if REVISION != "r07":
        assert checksum(accepted_project) == accepted_hash
    report = {"revision": "GAZE-01/" + REVISION, "placement": config,
        "accepted_artwork": "r06-layers/v2/native; user accepted and requested rig implementation",
        "source_unchanged": True, "r03_project_unchanged": True, "accepted_pngs_byte_identical": True,
        "fixed_layer_images_and_rects_identical_to_r03": True, "fixed_layer_extreme_renders_identical": True,
        "reopen_five_poses_identical": True, "reopen_parameters_identical": True,
        "outside_eye_region_identical_to_r03": True, "axis_samples": 21,
        "method": "Rigid mesh translation; iris masked by unchanged r03 sclera",
        "controller_acceptance": "Pending user review", "authored_clip": False,
        "export": "Not run: controller review stage; no runtime integration"}
    if REVISION != "r07":
        report["accepted_r07_project_unchanged"] = True
        report["accepted_r07_sha256"] = accepted_hash
        report["neutral_and_horizontal_extremes_identical_to_r07"] = True
        report["both_vertical_extremes_changed_from_r07"] = True
    write(OUT / "verification.json", report)
    write(ROOT / f"reviews/gaze-01-{REVISION}-controller.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["build", "verify"])
    parser.add_argument("--revision", choices=["r07", "r08"], default="r07")
    args = parser.parse_args()
    if args.revision == "r08":
        REVISION = "r08"
        OUT = ROOT / "work/gaze-01/r08"
        PROJECT = OUT / "gaze-01-r08.psd2live"
        PLACEMENT = {**PLACEMENT, "up_px": 8, "down_px": 4,
                     "reason": "User accepted r07 and requested larger amplitude and left/right",
                     "lower_limit": "One pixel beyond r07 downward limit; visually inspect rounded tip",
                     "combinations": "Current review uses cardinal directions separately"}
    (build if args.action == "build" else verify)()
