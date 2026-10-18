"""Two-axis gaze on independent iris layers; preserve every previous revision."""
import argparse
from datetime import datetime, timezone
import io
import json
import shutil

import numpy as np
from PIL import Image

from mcp import ROOT, client
from prototype_gaze_rigid import checksum, write
from prepare_mask_test import EXPECTED
from check_moc3 import check as check_moc3
from gaze_eye_support import extend_support

OUT = ROOT / "work/gaze-01/r04"
PROJECT = OUT / "gaze-01-r04.psd2live"
X, Y = "ParamGazeX", "ParamGazeY"
LAYERS = ["character_original", "white_right", "iris_right", "lash_right",
          "white_left", "iris_left", "lash_left"]


def render(c, name, x=0, y=0, face=True, imported=False, preview=False):
    rect = (350, 260, 330, 210) if face else (0, 0, 1024, 1536)
    request = {"viewport": dict(zip(["left", "top", "width", "height"], rect), mode="canvas_rect"),
               "parameters": {X: x, Y: y}, "target_long_edge": 990 if face else (768 if preview else 1536)}
    if not imported:
        request["include_layer_ids"] = LAYERS
    _, images = c.call("view_render_model", request)
    assert images
    path = OUT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(images[0])
    return np.array(Image.open(io.BytesIO(images[0])).convert("RGBA"))


def prepare():
    assert checksum(ROOT / "character_reference.png") == EXPECTED
    source = OUT / "source"
    source.mkdir(parents=True, exist_ok=True)
    prior = ROOT / "work/gaze-01/r03/source"
    layout = json.loads((prior / "layout.json").read_text())
    for layer in layout["layers"]:
        shutil.copy2(prior / layer["image"]["path"], source / layer["image"]["path"])
    layout["name"] = "Wisp two-axis gaze r04"
    write(OUT / "support-reconstruction.json", extend_support(source, layout))
    write(source / "layout.json", layout)
    return layout


def motion(c):
    stops = [(0, 0, 0), (.6, 0, 0), (1.2, 0, 1), (2, 0, 1), (2.8, 0, -1),
             (3.6, 0, -1), (4.3, -1, 0), (5.1, 1, 0), (5.8, 0, 0), (6.5, 0, 0)]
    curves = []
    for axis, field in [(X, 1), (Y, 2)]:
        keys = []
        for a, b in zip(stops, stops[1:]):
            for i in range(13):
                fraction = i / 13
                weight = fraction * fraction * (3 - 2 * fraction)
                keys.append({"time": round(a[0] + (b[0]-a[0])*fraction, 6),
                             "value": a[field] + (b[field]-a[field])*weight})
        keys.append({"time": stops[-1][0], "value": 0})
        curves.append({"parameter": axis, "keys": keys})
    clip = {"id": "gaze_xy", "name": "Gaze up down left right", "duration": 6.5,
            "fps": 30, "loop": True, "enabled": True, "fade_in": 0, "fade_out": 0, "curves": curves}
    c.edit("motion_put", clip=clip)
    write(OUT / "authored-motion.json", clip)


def build():
    if PROJECT.exists():
        raise RuntimeError("Existing project preserved; use verify or a new revision")
    layout = prepare()
    with client() as c:
        for operation in ["layer_mesh_update", "author_axis", "rig_edit_structure", "motion_put"]:
            write(OUT / (operation + ".schema.json"), c.call("workspace_get_operation", {"id": operation})[0])
        if c.project()["loaded"]:
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            c.edit("project_save_as", path=str(OUT / f"workspace-backup-{stamp}.psd2live"))
        c.edit("project_import_layout", path=str(OUT / "source/layout.json"))
        c.edit("settings_update", changes={"meshOnly": False, "generateDeformers": False,
            "generatePhysics": False, "featureDisplacementEnabled": False, "mouthOutlineEnabled": False,
            "motionBasic": False, "motionSkeleton": False, "exportMotions": True,
            "exportMoc3": True, "exportCmo3": True})
        for side in ["right", "left"]:
            for part in ["iris", "white"]:
                c.edit("layer_mesh_update", layer_id=part + "_" + side,
                       changes={"outerMargin": 2, "maxEdgeDistance": 6, "interiorDensity": 6})
        c.edit("rig_generate")
        objects = c.call("workspace_inspect", {"scope": "objects", "limit": 64})[0]
        write(OUT / "objects.json", objects)
        meshes = {p["layerId"]: p["target"] for p in objects["items"] if p["target"].startswith("mesh:")}
        c.edit("rig_edit_structure", edits=[{"action": "static", "kind": "mesh",
            "id": meshes["iris_" + side].split(":")[1],
            "masked_by": [meshes["white_" + side].split(":")[1]]} for side in ["right", "left"]])
        dimensions = {p["id"]: (p["rect"]["width"], p["rect"]["height"]) for p in layout["layers"]}
        horizontal = [{"target": meshes["iris_" + side], "value": value,
                       "operations": [{"type": "translate", "delta": [value * 8 / dimensions["iris_" + side][0], 0]}]}
                      for side in ["right", "left"] for value in [-1, 1]]
        c.edit("author_axis", parameter={"id": X, "name": "Gaze horizontal", "min": -1, "max": 1, "default": 0}, shapes=horizontal)
        vertical = [{"target": meshes["iris_" + side], "value": y, "key": {X: x},
                     "operations": [{"type": "translate", "delta": [0, y * 5 / dimensions["iris_" + side][1]]}]}
                    for side in ["right", "left"] for y in [-1, 1] for x in [-1, 0, 1]]
        c.edit("author_axis", parameter={"id": Y, "name": "Gaze vertical", "min": -1, "max": 1, "default": 0}, shapes=vertical)
        motion(c)
        c.edit("project_save_as", path=str(PROJECT))
        for x, y in [(0, 0), (-1, 0), (1, 0), (0, -1), (0, 1), (1, -1), (-1, 1)]:
            render(c, f"initial-{x}-{y}.png", x, y)
        print("Built", PROJECT, flush=True)


def stage_review():
    site = ROOT / "work/gaze-01/r02/review-site"
    shutil.copy2(ROOT / "reviews/gaze-01-r04.html", site / "reviews/gaze-01-r04.html")
    assets = site / "work/gaze-01/r04"
    assets.mkdir(parents=True, exist_ok=True)
    for name in ["frames", "web", PROJECT.name]:
        destination = assets / name
        if not destination.exists():
            destination.symlink_to(OUT / name, target_is_directory=(OUT / name).is_dir())


def verify():
    poses = [(x, y) for x in [-1, 0, 1] for y in [-1, 0, 1]]
    with client() as c:
        c.edit("project_open", path=str(PROJECT))
        before = [render(c, f"before-{i}.png", x, y) for i, (x, y) in enumerate(poses)]
        clip = c.call("motion_get", {"id": "gaze_xy"})[0]["clip"]
        c.edit("project_open", path=str(PROJECT))
        after = [render(c, f"after-{i}.png", x, y) for i, (x, y) in enumerate(poses)]
        assert all(np.array_equal(a, b) for a, b in zip(before, after))
        assert clip == c.call("motion_get", {"id": "gaze_xy"})[0]["clip"]
        assert not np.array_equal(after[3], after[5])
        assert not np.array_equal(after[1], after[7])
        stable = np.ones(after[0].shape[:2], dtype=bool)
        stable[120:450, 60:960] = False
        assert all(np.array_equal(a[stable], after[4][stable]) for a in after)
        for i in range(11):
            for j in range(11):
                x, y = (i-5)/5, (j-5)/5
                frame = render(c, f"frames/face-{i:02}-{j:02}.png", x, y)
                assert np.array_equal(frame[stable], after[4][stable])
                render(c, f"frames/full-{i:02}-{j:02}.png", x, y, face=False, preview=True)
            print(f"Rendered row {i+1}/11", flush=True)
        write(OUT / "export-response.json", c.edit("project_export_model", output_directory=str(OUT / "export")))
        model = next((OUT / "export").rglob("*.model3.json"))
        refs = json.loads(model.read_text())["FileReferences"]
        motions = [p["File"] for group in refs["Motions"].values() for p in group]
        for path in [refs["Moc"], *refs["Textures"], *motions]:
            assert (model.parent / path).is_file()
        assert any({X, Y}.issubset({v["Id"] for v in json.loads((model.parent / p).read_text())["Curves"]}) for p in motions)
        c.edit("project_import_cmo3", path=str(next((OUT / "export").rglob("*.cmo3"))), mode="new")
        try:
            imported = [render(c, f"imported-{i}.png", x, y, imported=True) for i, (x, y) in enumerate(poses)]
            assert all(np.array_equal(a, b) for a, b in zip(after, imported))
        finally:
            c.edit("project_save_as", path=str(OUT / "cmo3-roundtrip.psd2live"))
            c.edit("project_open", path=str(PROJECT))
        for target in ["web", "gif"]:
            settings = {"clip": "gaze_xy", "fps": "20", "size": "1024", "physics": "false", "background": "FFF0F2F5"} if target == "gif" else {}
            write(OUT / (target + "-export.json"), c.edit("project_export_target", target=target,
                  output_directory=str(OUT / target), settings=settings))
        assert checksum(ROOT / "character_reference.png") == EXPECTED
        report = {"source_unchanged": True, "reopen_poses_identical": True,
                  "reopen_motion_identical": True, "cmo3_roundtrip_poses_identical": True,
                  "poses_checked": 121, "outside_eye_region_static": True,
                  "authored_two_axis_motion_exported": True,
                  "acceptance": "r03 accepted; r04 user visual acceptance pending",
                  **check_moc3(model.parent / refs["Moc"])}
        write(OUT / "verification.json", report)
        stage_review()
        print(json.dumps(report, indent=2), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["build", "verify"])
    args = parser.parse_args()
    (build if args.action == "build" else verify)()
