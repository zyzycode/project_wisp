"""Independent rigid iris translation using the earlier full-rig eye layers."""
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

OUT = ROOT / "work/gaze-01/r03"
PARAM = "ParamGazeX"
PROJECT = OUT / "gaze-01-r03.psd2live"
OPS = ["project_save_as", "project_import_layout", "settings_update", "rig_generate", 
       "author_axis", "rig_edit_structure", "view_render_model", "motion_put",
       "motion_get", "project_open", "project_export_model", "project_export_target"]


def write(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def checksum(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare():
    """Reuse prior eye artwork locally; preserve the original outside eye patches."""
    assert checksum(ROOT / "character_reference.png") == EXPECTED
    dest = OUT / "source"
    dest.mkdir(parents=True, exist_ok=True)
    original = Image.open(ROOT / "character_reference.png").convert("RGBA")
    pixels = np.array(original)
    base = pixels.copy()
    old = ROOT / "work/full-rig-v1/source"
    entries = {p["id"]: p for p in json.loads((old / "layout.json").read_text())["layers"]}
    head = Image.new("RGBA", original.size)
    head_entry = entries["head_base"]
    head.paste(Image.open(old / head_entry["image"]["path"]),
               (head_entry["rect"]["left"], head_entry["rect"]["top"]))
    previous_head = np.array(head)
    allowed = np.zeros(pixels.shape[:2], dtype=bool)
    for x0, y0, x1, y1 in [(371, 302, 481, 400), (554, 302, 660, 400)]:
        base[y0:y1, x0:x1] = previous_head[y0:y1, x0:x1]
        allowed[y0:y1, x0:x1] = True
    Image.fromarray(base).save(dest / "character_original.png")
    layers = [{"id": "character_original", "name": "character_original",
        "image": {"path": "character_original.png", "width": 1024, "height": 1536},
        "rect": {"left": 0, "top": 0, "width": 1024, "height": 1536}, "tags": ["detail"]}]
    composite = Image.fromarray(base)
    reused = ["head_base"]
    for side in ["right", "left"]:
        for part in ["white", "iris", "lash"]:
            name = part + "_" + side
            entry = json.loads(json.dumps(entries[name]))
            entry["tags"] = ["detail"]
            shutil.copy2(old / entry["image"]["path"], dest / entry["image"]["path"])
            layer = Image.new("RGBA", original.size)
            layer.paste(Image.open(dest / entry["image"]["path"]),
                        (entry["rect"]["left"], entry["rect"]["top"]))
            composite = Image.alpha_composite(composite, layer)
            layers.append(entry)
            reused.append(name)
    actual = np.array(composite)
    assert np.array_equal(actual[~allowed], pixels[~allowed])
    composite.save(dest / "neutral.png")
    Image.fromarray((allowed * 255).astype("uint8")).save(dest / "eye-change-region.png")
    write(dest / "layout.json", {"format": "psd2live-layout", "version": 1,
        "name": "Wisp rigid horizontal gaze r03", "canvas": {"width": 1024, "height": 1536}, "layers": layers})
    write(dest / "preparation.json", {"source_sha256": EXPECTED,
        "outside_eye_regions_rgba_identical": True,
        "reused_layers": {name: checksum(old / entries[name]["image"]["path"]) for name in reused},
        "reused_reconstructed_artwork": ["prior sclera behind irises", "prior local skin under eye layers"],
        "method": "Reuse existing full-rig-v1 eye layers; original body and mouth; no new generation",
        "acceptance": "User rejected r02 deformation; r03 visual acceptance pending"})


def render(c, name, value, face=False, imported=False):
    rect = (350, 260, 330, 210) if face else (0, 0, 1024, 1536)
    viewport = dict(zip(["left", "top", "width", "height"], rect), mode="canvas_rect")
    request = {"viewport": viewport, "parameters": {PARAM: value},
               "target_long_edge": 990 if face else 1536}
    if not imported:
        request["include_layer_ids"] = ["character_original", "white_right", "iris_right", "lash_right", "white_left", "iris_left", "lash_left"]
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
        c.edit("rig_generate")
        objects = c.call("workspace_inspect", {"scope": "objects", "limit": 64})[0]
        write(OUT / "objects.json", objects)
        meshes = {p["layerId"]: p["target"] for p in objects["items"] if p["target"].startswith("mesh:")}
        c.edit("rig_edit_structure", edits=[{"action": "static", "kind": "mesh",
            "id": meshes["iris_" + side].split(":")[1],
            "masked_by": [meshes["white_" + side].split(":")[1]]} for side in ["right", "left"]])
        shapes = []
        for side in ["right", "left"]:
            width = Image.open(OUT / "source" / ("iris_" + side + ".png")).width
            for value in [-1, 1]:
                shapes.append({"target": meshes["iris_" + side], "value": value,
                    "operations": [{"type": "translate", "delta": [value * 8 / width, 0]}]})
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
        stable[302:401, 370:661] = False
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
    site = ROOT / "work/gaze-01/r02/review-site"
    (site / "reviews").mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT / "reviews/gaze-01-r03.html", site / "reviews/gaze-01-r03.html")
    assets = site / "work/gaze-01/r03"
    assets.mkdir(parents=True, exist_ok=True)
    for name in ["frames", "web", PROJECT.name]:
        target = assets / name
        if not target.exists():
            target.symlink_to(OUT / name, target_is_directory=(OUT / name).is_dir())
    previous = site / "work/gaze-01/r02/frames"
    previous.parent.mkdir(parents=True, exist_ok=True)
    if not previous.exists():
        previous.symlink_to(ROOT / "work/gaze-01/r02/frames", target_is_directory=True)
    if not (site / "character_reference.png").exists():
        (site / "character_reference.png").symlink_to(ROOT / "character_reference.png")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["build", "verify"])
    args = parser.parse_args()
    (build if args.action == "build" else verify)()
