"""Static downward pose references from r03 layers; no new gaze axis or motion."""
import argparse
import hashlib
import io
import json
import shutil
from datetime import datetime, timezone

import numpy as np
from PIL import Image

from mcp import ROOT, client
from prepare_mask_test import EXPECTED

OUT = ROOT / "work/gaze-01/r05-target"
BASE = ROOT / "work/gaze-01/r03"
LAYERS = ["character_original", "white_right", "iris_right", "lash_right",
          "white_left", "iris_left", "lash_left"]
POSES = {"neutral": (0, 0, 0), "down-a": (2, 0, 2), "down-b": (3, 0, 3),
         "down-c": (4, 4, 4), "down-d": (8, 8, 5)}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def render(c, folder, name, face):
    rect = (350, 260, 330, 210) if face else (0, 0, 1024, 1536)
    _, images = c.call("view_render_model", {
        "viewport": dict(zip(["left", "top", "width", "height"], rect), mode="canvas_rect"),
        "target_long_edge": 990 if face else 1536, "include_layer_ids": LAYERS})
    assert images
    (folder / name).write_bytes(images[0])
    return np.array(Image.open(io.BytesIO(images[0])).convert("RGBA"))


def prepare(name, down, shorten, lid_down):
    folder = OUT / name
    source = folder / "source"
    source.mkdir(parents=True, exist_ok=True)
    layout = json.loads((BASE / "source/layout.json").read_text())
    layout["name"] = "Wisp static downward target " + name
    for layer in layout["layers"]:
        filename = layer["image"]["path"]
        shutil.copy2(BASE / "source" / filename, source / filename)
        assert digest(source / filename) == digest(BASE / "source" / filename)
        rect = layer["rect"]
        if layer["id"].startswith("iris_"):
            rect["top"] += down
            rect["height"] -= shorten
        elif layer["id"].startswith("lash_"):
            rect["top"] += lid_down
        elif layer["id"].startswith("white_"):
            # Lower boundary and full width stay fixed; only upper aperture follows.
            rect["top"] += lid_down
            rect["height"] -= lid_down
    write(source / "layout.json", layout)
    return folder


def stage_review():
    site = ROOT / "work/gaze-01/r02/review-site"
    (site / "reviews").mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT / "reviews/gaze-01-r05-target.html", site / "reviews/gaze-01-r05-target.html")
    for pose in ["neutral", "down-c"]:
        dest = site / "work/gaze-01/r05-target" / pose
        dest.mkdir(parents=True, exist_ok=True)
        for name in ["face.png", "full.png", pose + ".psd2live"]:
            source, target = OUT / pose / name, dest / name
            if source.exists() and not target.exists():
                target.symlink_to(source)


def build(names):
    OUT.mkdir(parents=True, exist_ok=True)
    assert digest(ROOT / "character_reference.png") == EXPECTED
    for name in names:
        if (OUT / name / (name + ".psd2live")).exists():
            raise RuntimeError("Static candidate already exists: " + name)
    baseline_hash = digest(BASE / "gaze-01-r03.psd2live")
    report = {"stage": "static target reference; user selection pending",
              "new_gaze_axis": False, "authored_motion": False,
              "source_sha256": EXPECTED, "r03_project_sha256": baseline_hash,
              "source_layer_pixels_unchanged": True, "poses": {}}
    if (OUT / "verification.json").exists():
        report = json.loads((OUT / "verification.json").read_text())
    with client() as c:
        for operation in ["project_import_layout", "settings_update", "rig_generate",
                          "rig_edit_structure", "view_render_model", "project_save_as", "project_open"]:
            write(OUT / (operation + ".schema.json"), c.call("workspace_get_operation", {"id": operation})[0])
        if c.project()["loaded"]:
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            c.edit("project_save_as", path=str(OUT / ("workspace-backup-" + stamp + ".psd2live")))
        neutral = np.array(Image.open(BASE / "frames/full-10.png").convert("RGBA"))
        for name in names:
            down, shorten, lid_down = POSES[name]
            folder = prepare(name, down, shorten, lid_down)
            c.edit("project_import_layout", path=str(folder / "source/layout.json"))
            c.edit("settings_update", changes={"meshOnly": False, "generateDeformers": False,
                "generatePhysics": False, "featureDisplacementEnabled": False,
                "mouthOutlineEnabled": False, "motionBasic": False, "motionSkeleton": False})
            c.edit("rig_generate")
            objects = c.call("workspace_inspect", {"scope": "objects", "limit": 64})[0]
            write(folder / "objects.json", objects)
            meshes = {p["layerId"]: p["target"].split(":")[1] for p in objects["items"]
                      if p["target"].startswith("mesh:")}
            c.edit("rig_edit_structure", edits=[{"action": "static", "kind": "mesh",
                "id": meshes["iris_" + side], "masked_by": [meshes["white_" + side]]}
                for side in ["left", "right"]])
            project = folder / (name + ".psd2live")
            c.edit("project_save_as", path=str(project))
            full = render(c, folder, "full.png", False)
            face = render(c, folder, "face.png", True)
            c.edit("project_open", path=str(project))
            assert np.array_equal(full, render(c, folder, "reopened-full.png", False))
            assert np.array_equal(face, render(c, folder, "reopened-face.png", True))
            if name == "neutral":
                neutral = full
                accepted = np.array(Image.open(BASE / "frames/full-10.png").convert("RGBA"))
                assert np.array_equal(neutral, accepted), "Neutral must match accepted r03 render"
            stable = np.ones(full.shape[:2], dtype=bool)
            stable[302:401, 370:661] = False
            assert np.array_equal(full[stable], neutral[stable])
            report["poses"][name] = {"iris_top_down_px": down, "upper_lash_down_px": lid_down,
                "iris_height_reduction_px": shorten,
                "upper_aperture_down_px": lid_down, "aperture_width_and_bottom_unchanged": True,
                "reopen_identical": True, "outside_eyes_identical_to_r03": True,
                "changed_pixels_from_neutral": int(np.count_nonzero(np.any(full != neutral, axis=2)))}
            print("Saved static target", name, flush=True)
    assert digest(ROOT / "character_reference.png") == EXPECTED
    assert digest(BASE / "gaze-01-r03.psd2live") == baseline_hash
    write(OUT / "verification.json", report)
    stage_review()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", choices=list(POSES))
    args = parser.parse_args()
    build([args.candidate] if args.candidate else ["neutral", "down-c"])
