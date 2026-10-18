"""Isolated, small-range gaze prototype; never rebuilds or edits earlier rigs."""
import argparse
import hashlib
import io
import json
from datetime import datetime, timezone
import shutil

import numpy as np
from PIL import Image

from mcp import ROOT, client
from prepare_mask_test import EXPECTED
from check_moc3 import check as check_moc3

OUT = ROOT / "work/gaze-01/r02"
PARAM = "ParamGazeX"
PROJECT = OUT / "gaze-01-r02.psd2live"
OPS = ["project_save_as", "project_import_layout", "settings_update", "rig_generate", "layer_mesh_update",
       "author_axis", "rig_edit_structure", "view_render_model", "motion_put",
       "motion_get", "project_open", "project_export_model", "project_export_target"]


def write(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def checksum(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare():
    """Partition original pixels; no hidden artwork, resampling or reconstruction."""
    assert checksum(ROOT / "character_reference.png") == EXPECTED
    dest = OUT / "source"
    dest.mkdir(parents=True, exist_ok=True)
    original = Image.open(ROOT / "character_reference.png").convert("RGBA")
    pixels = np.array(original)
    foreground = pixels.copy()
    layers = []
    composite = Image.new("RGBA", original.size)
    for side, rect in [("right", (380, 306, 490, 406)), ("left", (548, 306, 658, 406))]:
        name = "detail_patch_" + side
        crop = original.crop(rect)
        crop.save(dest / (name + ".png"))
        composite.paste(crop, rect[:2])
        # Two unchanged-pixel overlap rows hide raster edge coverage seams.
        foreground[rect[1]+2:rect[3]-2, rect[0]+2:rect[2]-2] = 0
        layers.append({"id": name, "name": name,
            "image": {"path": name + ".png", "width": crop.width, "height": crop.height},
            "rect": {"left": rect[0], "top": rect[1], "width": crop.width, "height": crop.height},
            "tags": ["detail"]})
    Image.fromarray(foreground).save(dest / "character_original.png")
    composite = Image.alpha_composite(composite, Image.fromarray(foreground))
    actual = np.array(composite)
    delta = np.abs(actual.astype(int) - pixels.astype(int))
    assert delta[pixels[:, :, 3] > 0, :3].max() == 0
    assert delta[:, :, 3].max() <= 3
    composite.save(dest / "neutral.png")
    layers.append({"id": "character_original", "name": "character_original",
        "image": {"path": "character_original.png", "width": 1024, "height": 1536},
        "rect": {"left": 0, "top": 0, "width": 1024, "height": 1536}, "tags": ["detail"]})
    write(dest / "layout.json", {"format": "psd2live-layout", "version": 1,
        "name": "Wisp gentle gaze r02", "canvas": {"width": 1024, "height": 1536}, "layers": layers})
    write(dest / "preparation.json", {"source_sha256": EXPECTED,
        "neutral_visible_rgba_max_delta": int(delta[pixels[:, :, 3] > 0].max()),
        "neutral_rgb_identical": True, "overlap_alpha_max_delta": int(delta[:, :, 3].max()),
        "reconstructed_artwork": [], "method": "Original pixel partition; local native mesh deformation",
        "acceptance": "Autonomous prototype authorized by user; visual acceptance pending"})


def render(c, name, value, face=False, imported=False):
    rect = (350, 260, 330, 210) if face else (0, 0, 1024, 1536)
    viewport = dict(zip(["left", "top", "width", "height"], rect), mode="canvas_rect")
    request = {"viewport": viewport, "parameters": {PARAM: value},
               "target_long_edge": 990 if face else 1536}
    if not imported:
        request["include_layer_ids"] = ["detail_patch_right", "detail_patch_left", "character_original"]
    _, images = c.call("view_render_model", request)
    assert images
    path = OUT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(images[0])
    return np.array(Image.open(io.BytesIO(images[0])).convert("RGBA"))


def build():
    if PROJECT.exists():
        raise RuntimeError("Prototype already exists; use verify, or author a new revision")
    prepare()
    with client() as c:
        for op in OPS:
            write(OUT / (op + ".schema.json"), c.call("workspace_get_operation", {"id": op})[0])
        if c.project()["loaded"]:
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            c.edit("project_save_as", path=str(OUT / f"workspace-backup-{stamp}.psd2live"))
        c.edit("project_import_layout", path=str(OUT / "source/layout.json"))
        c.edit("settings_update", changes={"meshOnly": False, "generateDeformers": False,
            "generatePhysics": False, "featureDisplacementEnabled": False, "mouthOutlineEnabled": False,
            "motionBasic": False, "motionSkeleton": False, "exportMotions": True,
            "exportMoc3": True, "exportCmo3": True})
        for side in ["right", "left"]:
            c.edit("layer_mesh_update", layer_id="detail_patch_" + side,
                   changes={"maxEdgeDistance": 6, "interiorDensity": 6, "outerMargin": 0})
        c.edit("rig_generate")
        objects = c.call("workspace_inspect", {"scope": "objects", "limit": 64})[0]
        write(OUT / "objects.json", objects)
        meshes = {p["layerId"]: p["target"] for p in objects["items"] if p["target"].startswith("mesh:")}
        shapes = []
        for side, center in [("right", .58), ("left", .39)]:
            for value in [-1, 1]:
                shapes.append({"target": meshes["detail_patch_" + side], "value": value,
                    "selection": {"rect": [center-.23, .23, center+.23, .79], "feather": .18},
                    "operations": [{"type": "translate", "delta": [value * 4 / 110, 0]}]})
        c.edit("author_axis", parameter={"id": PARAM, "name": "Gentle gaze", "min": -1, "max": 1, "default": 0}, shapes=shapes)
        points = [(0, 0), (.6, 0), (1.1, -1), (1.9, -1), (2.7, 1), (3.5, 1), (4.2, 0), (5, 0)]
        # Smoothstep samples keep the native and review-page timing reproducible.
        keys = []
        for (t0, a), (t1, b) in zip(points, points[1:]):
            for i in range(13):
                t = i / 13
                keys.append({"time": round(t0 + (t1 - t0) * t, 6), "value": a + (b-a)*t*t*(3-2*t)})
        keys.append({"time": 5, "value": 0})
        clip = {"id": "gentle_gaze", "name": "Gentle gaze", "duration": 5, "fps": 30,
            "loop": True, "enabled": True, "fade_in": 0, "fade_out": 0,
            "curves": [{"parameter": PARAM, "keys": keys}]}
        c.edit("motion_put", clip=clip)
        write(OUT / "authored-motion.json", clip)
        c.edit("project_save_as", path=str(PROJECT))
        for index, value in enumerate([-1, 0, 1]):
            render(c, f"initial-face-{index}.png", value, face=True)
        print("Built", PROJECT, flush=True)


def verify():
    with client() as c:
        c.edit("project_open", path=str(PROJECT))
        before = [render(c, f"before-{i}.png", v) for i, v in enumerate([-1, 0, 1])]
        motion_before = c.call("motion_get", {"id": "gentle_gaze"})[0]["clip"]
        c.edit("project_open", path=str(PROJECT))
        after = [render(c, f"after-{i}.png", v) for i, v in enumerate([-1, 0, 1])]
        assert all(np.array_equal(a, b) for a, b in zip(before, after))
        assert not np.array_equal(after[0], after[2])
        assert motion_before == c.call("motion_get", {"id": "gentle_gaze"})[0]["clip"]
        stable = np.ones(after[0].shape[:2], dtype=bool)
        stable[306:407, 379:659] = False
        assert all(np.array_equal(a[stable], after[1][stable]) for a in after)
        for i in range(21):
            value = (i - 10) / 10
            frame = render(c, f"frames/full-{i:02}.png", value)
            assert np.array_equal(frame[stable], after[1][stable])
            render(c, f"frames/face-{i:02}.png", value, face=True)
        exported = c.edit("project_export_model", output_directory=str(OUT / "export"))
        write(OUT / "export-response.json", exported)
        model = next((OUT / "export").rglob("*.model3.json"))
        refs = json.loads(model.read_text())["FileReferences"]
        motions = [p["File"] for group in refs["Motions"].values() for p in group]
        for path in [refs["Moc"], *refs["Textures"], *motions]:
            assert (model.parent / path).is_file()
        assert any(PARAM in [v["Id"] for v in json.loads((model.parent / p).read_text())["Curves"]] for p in motions)
        c.call("workspace_get_operation", {"id": "project_import_cmo3"})
        c.edit("project_import_cmo3", path=str(next((OUT / "export").rglob("*.cmo3"))), mode="new")
        try:
            imported = [render(c, f"imported-{i}.png", v, imported=True) for i, v in enumerate([-1, 0, 1])]
            assert all(np.array_equal(a, b) for a, b in zip(after, imported))
        finally:
            c.edit("project_save_as", path=str(OUT / "cmo3-roundtrip.psd2live"))
            c.edit("project_open", path=str(PROJECT))
        assert checksum(ROOT / "character_reference.png") == EXPECTED
        report = {"source_unchanged": checksum(ROOT / "character_reference.png") == EXPECTED,
            "reopen_poses_identical": True, "reopen_motion_identical": True,
            "cmo3_roundtrip_poses_identical": True,
            "poses_checked": 21, "outside_eye_region_static": True, "authored_motion_exported": True,
            "acceptance": "Prototype only, user visual acceptance pending", **check_moc3(model.parent / refs["Moc"])}
        for target in ["web", "gif"]:
            settings = {"clip": "gentle_gaze", "fps": "20", "size": "1024", "physics": "false", "background": "FFF0F2F5"} if target == "gif" else {}
            result = c.edit("project_export_target", target=target, output_directory=str(OUT / target), settings=settings)
            write(OUT / (target + "-export.json"), result)
        write(OUT / "verification.json", report)
        stage_review()
        print(json.dumps(report, indent=2), flush=True)


def stage_review():
    """Expose only review artifacts, never editor preferences or credentials."""
    site = OUT / "review-site"
    (site / "reviews").mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT / "reviews/gaze-01-r02.html", site / "reviews/gaze-01-r02.html")
    assets = site / "work/gaze-01/r02"
    assets.mkdir(parents=True, exist_ok=True)
    for name in ["frames", "web", PROJECT.name]:
        target = assets / name
        if not target.exists():
            target.symlink_to(OUT / name, target_is_directory=(OUT / name).is_dir())
    if not (site / "character_reference.png").exists():
        (site / "character_reference.png").symlink_to(ROOT / "character_reference.png")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["build", "verify"])
    args = parser.parse_args()
    (build if args.action == "build" else verify)()
