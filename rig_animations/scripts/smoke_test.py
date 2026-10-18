"""MCP integration check for the isolated PSD2Live editor (no product changes)."""
from datetime import datetime, timezone
import hashlib
import io
import json
from pathlib import Path
import shutil
import urllib.error
import urllib.request

from PIL import Image, ImageChops

from mcp import ROOT, client
from check_moc3 import check as check_moc3

OPERATIONS = ["project_import_layout", "rig_generate", "workspace_inspect",
              "author_axis", "view_render_poses", "project_save_as", "project_open",
              "project_export_model", "project_import_cmo3", "motion_put", "settings_update",
              "workspace_overview", "motion_get", "view_render_model", "view_sample_motion"]


def write_json(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def source_layout(directory):
    directory.mkdir()
    shutil.copyfile(ROOT / "character_reference.png", directory / "character.png")
    layout = {"format":"psd2live-layout", "version":1, "name":"wisp-environment-smoke",
              "canvas":{"width":1024,"height":1536}, "layers":[{
                  "id":"character", "name":"character",
                  "image":{"path":"character.png","width":1024,"height":1536},
                  "rect":{"left":0,"top":0,"width":1024,"height":1536}}]}
    write_json(directory / "layout.json", layout)
    return directory / "layout.json"


def same_pixels(before, after):
    a = Image.open(io.BytesIO(before)).convert("RGBA")
    b = Image.open(io.BytesIO(after)).convert("RGBA")
    return a.size == b.size and not any(ImageChops.difference(a,b).getextrema()[i][1] for i in range(4))


def render(editor, directory, name):
    data, images = editor.call("view_render_poses", {
        "viewport":{"mode":"canvas_rect","left":0,"top":0,"width":1024,"height":1536},
        "poses":[{"ParamSmokeX":-1},{"ParamSmokeX":0},{"ParamSmokeX":1}],
        "columns":3, "target_long_edge":512})
    if not images:
        raise RuntimeError("Renderer returned no images")
    for index, png in enumerate(images):
        (directory / f"{name}-{index}.png").write_bytes(png)
    write_json(directory / f"{name}.json", data)
    return images


def main():
    directory = ROOT / "work" / datetime.now(timezone.utc).strftime("smoke-%Y%m%dT%H%M%S%fZ")
    directory.mkdir(parents=True)
    report = {"editor_version":"3.5.1", "passed":False}
    try:
        with client() as editor:
            try:
                urllib.request.urlopen(urllib.request.Request(editor.endpoint, data=b"{}",
                    headers={"Content-Type":"application/json"}), timeout=5)
            except urllib.error.HTTPError as error:
                report["unauthenticated_http_status"] = error.code
            assert report.get("unauthenticated_http_status") == 401
            report["published_tools"] = len(editor.tools())
            schemas = {op:editor.call("workspace_get_operation", {"id":op})[0] for op in OPERATIONS}
            write_json(directory / "schemas.json", schemas)
            # Import refuses any unsaved user work; never set discard_unsaved.
            editor.edit("project_import_layout", path=str(source_layout(directory / "input")))
            editor.edit("settings_update", changes={"meshOnly":False, "generateDeformers":False,
                "generatePhysics":False, "motionBasic":False, "motionSkeleton":False,
                "exportMotions":True, "exportMoc3":True, "exportCmo3":True})
            editor.edit("rig_generate")
            objects = editor.call("workspace_inspect", {"scope":"objects","limit":64})[0]
            write_json(directory / "objects.json", objects)
            run_model_check(editor, directory, objects, report)
        report["passed"] = True
    finally:
        write_json(directory / "verification.json", report)
        print(f"Evidence: {directory}", flush=True)
    print(json.dumps(report, indent=2))


def run_model_check(editor, directory, objects, report):
    meshes = [item["target"] for item in objects["items"] if item["target"].startswith("mesh:")]
    assert len(meshes) == 1
    editor.edit("author_axis", parameter={"id":"ParamSmokeX","name":"Smoke X",
        "min":-1,"max":1,"default":0}, shapes=[
            {"target":meshes[0],"value":value,"operations":[{"type":"translate","delta":[value*0.02,0]}]}
            for value in [-1,1]])
    editor.edit("motion_put", clip={"id":"smoke","name":"Smoke","duration":1,"fps":30,
        "loop":True,"enabled":True,"fade_in":0,"fade_out":0,"curves":[{
            "parameter":"ParamSmokeX","keys":[{"time":0,"value":-1},
            {"time":0.5,"value":1},{"time":1,"value":-1}]}]})
    before = render(editor, directory, "before-save")
    poses = []
    for value in [-1,1]:
        _, images = editor.call("view_render_model", {
            "viewport":{"mode":"canvas_rect","left":0,"top":0,"width":1024,"height":1536},
            "parameters":{"ParamSmokeX":value}, "include_layer_ids":["character"],
            "target_long_edge":512})
        poses.append(images[0])
    assert not same_pixels(*poses), "Parameter must visibly move model geometry"
    report["parameter_changes_render"] = True
    overview_before = editor.call("workspace_overview")[0]
    motion_before = editor.call("motion_get", {"id":"smoke"})[0]
    project = directory / "character.psd2live"
    saved = editor.edit("project_save_as", path=str(project))
    assert project.is_file() and project.stat().st_size > 0
    reopened = editor.edit("project_open", path=str(project))
    assert saved["state"] != reopened["state"]
    assert saved["revision"] == reopened["revision"]
    assert saved["history_node_id"] == reopened["history_node_id"]
    after = render(editor, directory, "after-reopen")
    assert len(before) == len(after) and all(same_pixels(a,b) for a,b in zip(before,after))
    report["reopened_render_identical"] = True
    report["revision_and_history_preserved"] = True
    overview_after = editor.call("workspace_overview")[0]
    motion_after = editor.call("motion_get", {"id":"smoke"})[0]
    def stable(data):
        return {k:v for k,v in data.items() if k not in {"state","project_id","history_node_id"}}
    assert stable(overview_before) == stable(overview_after)
    assert stable(motion_before) == stable(motion_after)
    report["structure_and_motion_preserved"] = True
    write_json(directory / "overview.json", overview_after)
    exported = editor.edit("project_export_model", output_directory=str(directory / "export"))
    write_json(directory / "export-response.json", exported)
    files = sorted((directory / "export").rglob("*"))
    model3 = next(path for path in files if path.name.endswith(".model3.json"))
    refs = json.loads(model3.read_text())["FileReferences"]
    for relative in [refs["Moc"], *refs["Textures"]]:
        assert (model3.parent / relative).is_file()
    motion_files = [entry["File"] for entries in refs.get("Motions", {}).values() for entry in entries]
    assert motion_files, "Export must include the authored test motion"
    motion_parameters = set()
    for relative in motion_files:
        motion_data = json.loads((model3.parent / relative).read_text())
        motion_parameters.update(curve["Id"] for curve in motion_data["Curves"])
    assert "ParamSmokeX" in motion_parameters
    report["authored_motion_exported"] = True
    moc = model3.parent / refs["Moc"]
    assert moc.read_bytes()[:4] == b"MOC3"
    report.update(check_moc3(moc))
    report["export_files"] = [str(path.relative_to(directory)) for path in files if path.is_file()]
    report["moc3_sha256"] = hashlib.sha256(moc.read_bytes()).hexdigest()
    cmo3 = next(path for path in files if path.suffix == ".cmo3")
    editor.edit("project_import_cmo3", path=str(cmo3), mode="new")
    imported = render(editor, directory, "imported-cmo3")
    report["cmo3_import_render_identical"] = len(before) == len(imported) and all(
        same_pixels(a,b) for a,b in zip(before,imported))
    assert report["cmo3_import_render_identical"]
    # Preserve the imported project as evidence before returning to the editable original.
    editor.edit("project_save_as", path=str(directory / "imported.psd2live"))
    editor.edit("project_open", path=str(project))
    report["project"] = str(project.relative_to(ROOT))


if __name__ == "__main__":
    main()
