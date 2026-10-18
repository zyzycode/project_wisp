"""Build only the r11 hand/forearm review, without authoring a motion."""
from datetime import datetime, timezone
import hashlib
import io
import json

from PIL import Image

from mcp import ROOT, client

OUT = ROOT / "work/arm-01/r11-layers"
PROJECT = OUT / "arm-01-r11-wrist.psd2live"


def write(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def main():
    if PROJECT.exists():
        raise RuntimeError("Preserve the existing review; use a new revision")
    layers = []
    for name, left, top in [("forearm_L", 64, 115), ("hand_L", 104, 10)]:
        width, height = Image.open(OUT / "native" / (name + ".png")).size
        layers.append({"id": name, "name": name,
                       "image": {"path": "native/" + name + ".png", "width": width, "height": height},
                       "rect": {"left": left, "top": top, "width": width, "height": height},
                       "tags": ["detail"]})
    write(OUT / "layout.json", {"format": "psd2live-layout", "version": 1,
          "name": "ARM-01 r11 wrist subassembly only", "canvas": {"width": 240, "height": 330},
          "layers": layers})
    renders = {}
    with client() as c:
        for op in ["project_save_as", "project_import_layout", "settings_update",
                   "rig_generate", "view_render_model", "project_open"]:
            write(OUT / (op + ".schema.json"), c.call("workspace_get_operation", {"id": op})[0])
        state = c.project()
        assert not state["busy"]
        if state["loaded"]:
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            backup = OUT / ("workspace-backup-" + stamp + ".psd2live")
            c.edit("project_save_as", path=str(backup))
            assert backup.is_file() and backup.stat().st_size
        c.edit("project_import_layout", path=str(OUT / "layout.json"))
        c.edit("settings_update", changes={"meshOnly": True, "generateDeformers": False,
               "alphaThreshold": 1, "meshOuterMargin": 2, "meshUnits": "PIXELS",
               "meshMaxEdgeDistance": 6,
               "generatePhysics": False, "featureDisplacementEnabled": False,
               "mouthOutlineEnabled": False, "motionBasic": False, "motionIdle": False,
               "motionBlink": False, "motionNod": False, "motionShake": False,
               "motionSkeleton": False})
        c.edit("rig_generate")
        c.edit("project_save_as", path=str(PROJECT))
        for phase in ["before", "after"]:
            if phase == "after":
                c.edit("project_open", path=str(PROJECT))
            state = c.project()
            assert state["layers"] == 2
            for view, rect, edge in [("assembly", (0, 0, 240, 330), 990),
                                     ("wrist", (112, 108, 65, 60), 520)]:
                _, images = c.call("view_render_model", {
                    "viewport": dict(zip(["left", "top", "width", "height"], rect), mode="canvas_rect"),
                    "include_layer_ids": ["forearm_L", "hand_L"], "background": "transparent",
                    "target_long_edge": edge})
                assert images
                (OUT / (view + "-" + phase + ".png")).write_bytes(images[0])
                renders[view, phase] = Image.open(io.BytesIO(images[0])).convert("RGBA").tobytes()
    assert all(renders[view, "before"] == renders[view, "after"] for view in ["assembly", "wrist"])
    accepted = json.loads((ROOT / "reviews/gaze-01-r08-acceptance.json").read_text())["sha256"]
    assert all(hashlib.sha256((ROOT / path).read_bytes()).hexdigest() == expected
               for path, expected in accepted.items())
    write(OUT / "verification.json", {"layers": 2, "saved_and_reopened": True,
          "assembly_and_wrist_pixels_equal_after_reopen": True, "accepted_gaze_and_original_unchanged": True,
          "scope": "static wrist subassembly, not full arm or motion"})
    print("PASS: two layers, save/reopen, identical renders, preserved gaze/source")


if __name__ == "__main__":
    main()
