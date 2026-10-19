"""Save/reopen the five-layer r13 authoring assembly; no movement or character replacement."""
from datetime import datetime, timezone
import hashlib
import io
import json

import numpy as np
from PIL import Image

from mcp import ROOT, client

OUT = ROOT / "work/arm-01/r13-arm"
PROJECT = OUT / "arm-01-r13-layers.psd2live"
IDS = ["upper_arm_L", "forearm_L", "hand_L", "bracelet_red_L", "bracelet_blue_L"]


def main():
    if PROJECT.exists():
        raise RuntimeError("Preserve this revision; use a new output for changes")
    layout = json.loads((OUT / "layout.json").read_text())
    assert [layer["id"] for layer in layout["layers"]] == IDS
    renders = {}
    with client() as c:
        for op in ["project_save_as", "project_open", "project_import_layout", "settings_update",
                   "rig_generate", "view_render_model"]:
            schema = c.call("workspace_get_operation", {"id": op})[0]
            (OUT / (op+".schema.json")).write_text(json.dumps(schema, indent=2))
        state = c.project()
        assert not state["busy"]
        if state["loaded"]:
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            backup = OUT / ("workspace-backup-"+stamp+".psd2live")
            c.edit("project_save_as", path=str(backup))
            assert backup.is_file() and backup.stat().st_size
        c.edit("project_import_layout", path=str(OUT / "layout.json"))
        c.edit("settings_update", changes={"meshOnly": True, "alphaThreshold": 1,
               "meshOuterMargin": 2, "meshUnits": "PIXELS", "meshMaxEdgeDistance": 6,
               "generateDeformers": False, "generatePhysics": False, "featureDisplacementEnabled": False,
               "mouthOutlineEnabled": False, "motionBasic": False, "motionIdle": False,
               "motionBlink": False, "motionNod": False, "motionShake": False, "motionSkeleton": False})
        c.edit("rig_generate")
        c.edit("project_save_as", path=str(PROJECT))
        views = [("assembly", (0, 0, 440, 380), 880, IDS),
                 ("elbow", (240, 260, 100, 90), 600, IDS),
                 ("bracelets", (285, 130, 75, 60), 600, IDS),
                 ("wrist-uncovered", (292, 138, 65, 60), 520, ["forearm_L", "hand_L"])]
        for phase in ["before", "after"]:
            if phase == "after":
                c.edit("project_open", path=str(PROJECT))
            assert c.project()["layers"] == 5
            for name, rect, edge, ids in views:
                _, images = c.call("view_render_model", {
                    "viewport": dict(zip(["left", "top", "width", "height"], rect), mode="canvas_rect"),
                    "include_layer_ids": ids, "background": "transparent", "target_long_edge": edge})
                assert images
                (OUT / (name+"-"+phase+".png")).write_bytes(images[0])
                renders[name, phase] = np.array(Image.open(io.BytesIO(images[0])).convert("RGBA"))
    assert all(np.array_equal(renders[name, "before"], renders[name, "after"]) for name, *_ in views)
    for acceptance in ["gaze-01-r08-acceptance.json", "arm-01-r12-acceptance.json"]:
        for path, expected in json.loads((ROOT / "reviews" / acceptance).read_text())["sha256"].items():
            assert hashlib.sha256((ROOT / path).read_bytes()).hexdigest() == expected, path
    prior = np.array(Image.open(ROOT / "work/arm-01/r12-wrist/native/forearm_L.png").convert("RGBA"))
    current = np.array(Image.open(OUT / "native/forearm_L.png").convert("RGBA"))
    assert np.array_equal(prior[:138], current[:138])
    assert np.array_equal(prior[:, :, :3], current[:, :, :3])
    assert (OUT / "native/hand_L.png").read_bytes() == (ROOT / "work/arm-01/r12-wrist/native/hand_L.png").read_bytes()
    old = np.array(Image.open(ROOT / "work/arm-01/r12-wrist/wrist-after.png").convert("RGBA"))
    difference = np.abs(old.astype(int)-renders["wrist-uncovered", "after"].astype(int))
    now = renders["wrist-uncovered", "after"].astype(float)
    premultiplied = np.abs(old[:, :, :3].astype(float)*old[:, :, 3:]/255 - now[:, :, :3]*now[:, :, 3:]/255)
    result = {"layers": 5, "save_reopen_all_four_views_equal": True,
              "accepted_files_hashes_unchanged": True, "hand_bytes_unchanged": True,
              "forearm_rgb_unchanged": True, "forearm_above_local_y138_pixels_unchanged": True,
              "wrist_r12_vs_r13_max_channel_difference": int(difference.max()),
              "wrist_r12_vs_r13_mean_channel_difference": float(difference.mean()),
              "wrist_premultiplied_mean_difference": float(premultiplied.mean()),
              "wrist_pixels_with_premultiplied_difference_over_2": int((premultiplied.max(axis=2)>2).sum()),
              "wrist_render_note": "Texture pixels preserved; regenerated mesh/atlas produces small fringe rasterization differences",
              "scope": "Static separate arm assembly; no full-character neutral, controller or export"}
    (OUT / "verification.json").write_text(json.dumps(result, indent=2)+"\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
