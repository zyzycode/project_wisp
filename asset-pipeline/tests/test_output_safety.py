"""Exercise direct PNG exports in a fixture repo; manifest and app code are immutable."""

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

from PIL import Image, ImageDraw


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


class PipelineSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.pipeline = self.root / "asset-pipeline"
        self.scripts = self.pipeline / "scripts"
        shutil.copytree(SCRIPTS, self.scripts, ignore=shutil.ignore_patterns("__pycache__"))
        self.output = self.pipeline / "output"
        self.input = self.pipeline / "input"
        self.input.mkdir()
        self.production = self.root / "public/assets/sprites"
        self.production.mkdir(parents=True)
        self.manifest = self.production / "manifest.json"
        self.manifest.write_text(json.dumps({
            "face_happy": {"category": "faces/happy", "fps": 7, "frames": [
                f"/assets/sprites/faces/happy/face_happy_{index:02d}.png" for index in range(6)
            ]},
            "body_idle": {"category": "body/idle", "frames": ["/assets/sprites/body/idle/body_idle_00.png"]},
        }))
        self.frames = self.production / "faces/happy"
        self.frames.mkdir(parents=True)
        for index in range(6):
            image = Image.new("RGBA", (512, 512))
            ImageDraw.Draw(image).rectangle((220, 160, 280 + index, 200), fill="red")
            image.save(self.frames / f"face_happy_{index:02d}.png")
        self.unrelated = self.production / "body/idle/body_idle_00.png"
        self.unrelated.parent.mkdir(parents=True)
        shutil.copyfile(self.frames / "face_happy_00.png", self.unrelated)
        self.before = self.snapshot(self.production)
        self.source = self.input / "face_happy.png"
        sheet = Image.new("RGBA", (256, 64))
        draw = ImageDraw.Draw(sheet)
        for index in range(4):
            draw.rectangle((index * 64 + 8, 8, index * 64 + 50, 50), fill="blue")
        sheet.save(self.source)
        (self.root / "src").mkdir()
        (self.root / "src/app.ts").write_text("app code stays unchanged")
        (self.root / "docs").mkdir()
        (self.root / "docs/render.md").write_text("render contract stays unchanged")

    @staticmethod
    def snapshot(path):
        return {str(p.relative_to(path)): p.read_bytes() for p in path.rglob("*") if p.is_file()}

    def execute(self, arguments, expected=0, cwd=None):
        protected = {
            self.manifest: self.manifest.read_bytes(),
            self.root / "src/app.ts": (self.root / "src/app.ts").read_bytes(),
            self.root / "docs/render.md": (self.root / "docs/render.md").read_bytes(),
        }
        result = subprocess.run(
            [sys.executable, *map(str, arguments)],
            cwd=cwd or self.root, capture_output=True, text=True,
            env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
        )
        if expected == 0:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        for path, contents in protected.items():
            self.assertEqual(path.read_bytes(), contents, str(path))
        return result

    def run_tool(self, name, *args, expected=0, cwd=None):
        return self.execute([self.scripts / name, *args], expected=expected, cwd=cwd)

    def run_python(self, code, *args, expected=0):
        return self.execute([
            "-c", "import sys; sys.path.insert(0, sys.argv[1]); " + code,
            self.scripts, *args,
        ], expected=expected)

    def test_processing_exports_directly_and_preserves_extra_referenced_frames(self):
        original_source = self.source.read_bytes()
        result = self.run_tool("process_sprites.py")
        proposal = json.loads((self.output / "manifest-proposal.json").read_text())
        self.assertEqual(proposal["kind"], "wisp-asset-proposal")
        self.assertEqual(proposal["exportTarget"], "public/assets/sprites")
        self.assertEqual(set(proposal["entries"]), {"face_happy"})
        entry = proposal["entries"]["face_happy"]
        self.assertEqual(entry["fps"], 7)
        self.assertEqual(entry["framesCount"], 4)
        for url in entry["frames"]:
            self.assertTrue(url.startswith("/assets/sprites/faces/happy/"))
            path = self.production / url.removeprefix("/assets/sprites/")
            self.assertNotEqual(path.read_bytes(), self.before[str(path.relative_to(self.production))])
            with Image.open(path) as frame:
                self.assertEqual(frame.size, (512, 512))
        for index in (4, 5):
            path = self.frames / f"face_happy_{index:02d}.png"
            self.assertEqual(path.read_bytes(), self.before[str(path.relative_to(self.production))])
        self.assertEqual(self.unrelated.read_bytes(), self.before[str(self.unrelated.relative_to(self.production))])
        self.assertEqual(self.source.read_bytes(), original_source)
        self.assertIn("Preserved 2 extra frame(s)", result.stdout)
        self.assertFalse((self.output / "sprites").exists())

    def test_cache_skips_complete_export_but_recreates_missing_production_frames(self):
        self.run_tool("process_sprites.py")
        first_frame = self.frames / "face_happy_00.png"
        before_time = first_frame.stat().st_mtime_ns
        before_metadata = self.snapshot(self.output)
        result = self.run_tool("process_sprites.py")
        self.assertIn("Processed 0 sheet(s)", result.stdout)
        self.assertEqual(first_frame.stat().st_mtime_ns, before_time)
        self.assertEqual(self.snapshot(self.output), before_metadata)
        first_frame.unlink()
        self.run_tool("process_sprites.py")
        self.assertTrue(first_frame.is_file())

    def test_staged_cache_and_proposal_cannot_skip_direct_export(self):
        old_frames = self.output / "sprites/faces/happy"
        shutil.copytree(self.frames, old_frames)
        source_hash = hashlib.md5(self.source.read_bytes()).hexdigest()
        (self.output / ".sprites_cache.json").write_text(json.dumps({str(self.source): source_hash}))
        (self.output / "manifest-proposal.json").write_text(json.dumps({
            "kind": "wisp-asset-proposal", "entries": {"face_happy": {
                "category": "faces/happy", "frames": ["sprites/faces/happy/face_happy_00.png"],
            }},
        }))
        first_frame = self.frames / "face_happy_00.png"
        original = first_frame.read_bytes()
        self.run_tool("process_sprites.py")
        self.assertNotEqual(first_frame.read_bytes(), original)
        self.assertTrue((old_frames / "face_happy_00.png").is_file())

    def test_dry_run_does_not_create_output_or_change_production(self):
        self.run_tool("process_sprites.py", "--dry-run")
        self.assertFalse(self.output.exists())
        self.assertEqual(self.snapshot(self.production), self.before)

    def test_legacy_input_can_be_read_without_moving_or_modifying_it(self):
        legacy = self.root / "generated_images"
        legacy.mkdir()
        external = legacy / self.source.name
        self.source.rename(external)
        original = external.read_bytes()
        self.run_tool("process_sprites.py", "--file", external)
        self.assertEqual(external.read_bytes(), original)
        self.assertTrue((self.output / "manifest-proposal.json").is_file())

    def test_preview_and_wrapper_read_production_but_write_only_local_gifs(self):
        self.run_tool("preview_sprites.py", self.frames)
        self.assertTrue((self.output / "previews/preview_happy.gif").is_file())
        self.run_tool("make_gif.py", self.frames, cwd=self.production)
        self.run_tool("preview_sprites.py", "--all")
        self.assertTrue((self.output / "previews/preview_faces_happy.gif").is_file())
        self.assertFalse(list(self.root.glob("*.gif")))
        self.assertEqual(self.snapshot(self.production), self.before)

    def test_rescale_updates_production_in_place(self):
        self.run_tool("scale_overlay.py", "--folder", self.frames, "--scale", "0.5")
        result = self.frames / "face_happy_00.png"
        self.assertNotEqual(result.read_bytes(), self.before[str(result.relative_to(self.production))])
        with Image.open(result) as frame:
            box = frame.getbbox()
            self.assertLess(box[2] - box[0], 61)
        self.assertEqual(self.unrelated.read_bytes(), self.before[str(self.unrelated.relative_to(self.production))])
        self.assertFalse(list(self.production.rglob("*.bak.png")))
        self.assertFalse((self.output / "scaled").exists())

    def test_rescale_external_input_requires_final_destination_and_preserves_originals(self):
        external = self.input / "faces"
        shutil.copytree(self.frames, external)
        original = self.snapshot(external)
        self.run_tool("scale_overlay.py", "--folder", external, "--scale", ".5", expected=1)
        self.assertEqual(self.snapshot(self.production), self.before)
        self.run_tool("scale_overlay.py", "--folder", external, "--scale", ".5", "--output", self.frames)
        self.assertEqual(self.snapshot(external), original)
        self.assertNotEqual(self.snapshot(self.production), self.before)

    def test_wrong_output_roots_and_traversal_are_rejected(self):
        for tool in ("preview_sprites.py", "make_gif.py"):
            for path in (self.production / "preview.gif", self.output / "../../public/preview.gif"):
                with self.subTest(tool=tool, path=path):
                    self.run_tool(tool, self.frames, "--output", path, expected=1)
        for destination in (self.output / "scaled", self.production / "../../../src", self.root / "docs"):
            self.run_tool("scale_overlay.py", "--folder", self.frames, "--scale", ".5", "--output", destination, expected=1)
        self.assertEqual(self.snapshot(self.production), self.before)

    def test_png_guard_rejects_json_and_code_even_with_custom_programmatic_paths(self):
        cases = [
            ("from preview_sprites import frames_to_gif; frames_to_gif([sys.argv[2]], sys.argv[3])", self.frames / "face_happy_00.png", self.manifest),
            ("from process_sprites import process_single_image; process_single_image(sys.argv[2], sys.argv[3], {})", self.source, self.root / "src"),
            ("from lib.manifest_sync import save_proposal; save_proposal({}, sys.argv[3])", self.source, self.manifest),
            ("from lib.output_paths import prepare_sprite_file; prepare_sprite_file(sys.argv[3]).write_text('overwrite')", self.source, self.manifest),
            ("from lib.output_paths import prepare_sprite_file; prepare_sprite_file(sys.argv[3]).write_text('overwrite')", self.source, self.production / "manifest.json:stream.png"),
            ("from lib.output_paths import prepare_sprite_file; prepare_sprite_file(sys.argv[3]).write_text('overwrite')", self.source, self.root / "src/app.ts"),
        ]
        for code, source, destination in cases:
            with self.subTest(code=code, destination=destination):
                self.run_python(code, source, destination, expected=1)
        self.assertEqual(self.snapshot(self.production), self.before)

    def symlink(self, link, target, is_directory=False):
        try:
            link.symlink_to(target, target_is_directory=is_directory)
        except (OSError, NotImplementedError) as exc:
            self.skipTest(f"Symlinks unavailable: {exc}")

    def test_output_root_or_proposal_symlink_cannot_overwrite_manifest(self):
        self.symlink(self.output, self.production, True)
        self.run_tool("process_sprites.py", expected=1)
        self.run_tool("preview_sprites.py", self.frames, expected=1)
        self.output.unlink()
        self.output.mkdir()
        self.symlink(self.output / "manifest-proposal.json", self.manifest)
        self.run_tool("process_sprites.py", expected=1)
        self.assertEqual(self.snapshot(self.production), self.before)

    def test_production_folder_symlink_cannot_redirect_exports(self):
        saved_frames = self.root / "external-frames"
        self.frames.rename(saved_frames)
        self.symlink(self.frames, saved_frames, True)
        original = self.snapshot(saved_frames)
        self.run_tool("process_sprites.py", expected=1)
        self.run_tool("scale_overlay.py", "--folder", self.frames, "--scale", ".5", expected=1)
        self.assertEqual(self.snapshot(saved_frames), original)

    def test_production_root_symlink_cannot_redirect_exports(self):
        relocated = self.root / "external-sprites"
        self.production.rename(relocated)
        self.symlink(self.production, relocated, True)
        original = self.snapshot(relocated)
        self.run_tool("process_sprites.py", expected=1)
        self.run_tool("scale_overlay.py", "--folder", self.frames, "--scale", ".5", expected=1)
        self.assertEqual(self.snapshot(relocated), original)

    def test_external_alias_cannot_authorize_in_place_scaling(self):
        external = self.input / "alias"
        self.symlink(external, self.frames, True)
        self.run_tool("scale_overlay.py", "--folder", external, "--scale", ".5", "--output", self.frames, expected=1)
        self.assertEqual(self.snapshot(self.production), self.before)

    def test_png_symlink_cannot_overwrite_manifest_or_another_asset(self):
        frame = self.frames / "face_happy_00.png"
        for target in (self.manifest, self.unrelated):
            with self.subTest(target=target):
                frame.unlink()
                self.symlink(frame, target)
                target_before = target.read_bytes()
                self.run_tool("process_sprites.py", expected=1)
                self.run_tool("scale_overlay.py", "--folder", self.frames, "--scale", ".5", expected=1)
                self.assertEqual(target.read_bytes(), target_before)

    def test_hard_links_cannot_overwrite_manifest_or_external_references(self):
        frame = self.frames / "face_happy_00.png"
        for target in (self.manifest, self.source):
            with self.subTest(target=target):
                frame.unlink()
                try:
                    os.link(target, frame)
                except (OSError, NotImplementedError) as exc:
                    self.skipTest(f"Hard links unavailable: {exc}")
                target_before = target.read_bytes()
                self.run_tool("process_sprites.py", expected=1)
                self.run_tool("scale_overlay.py", "--folder", self.frames, "--scale", ".5", expected=1)
                self.assertEqual(target.read_bytes(), target_before)

    def test_manifest_routing_cannot_write_outside_sprites(self):
        self.source.rename(self.input / "custom-sheet.png")
        payload = {"custom": {"sourceFile": "custom-sheet.png", "category": str(self.root / "src")}}
        self.manifest.write_text(json.dumps(payload))
        self.run_tool("process_sprites.py", expected=1)
        self.assertFalse((self.root / "src/custom_00.png").exists())

    def test_source_sheet_inside_production_is_not_overwritten(self):
        folder = self.production / "custom"
        folder.mkdir(parents=True)
        source = folder / "custom_00.png"
        shutil.copyfile(self.source, source)
        original = source.read_bytes()
        code = (
            "from process_sprites import process_single_image; "
            "process_single_image(sys.argv[2], sys.argv[3], "
            "{'custom': {'sourceFile': 'custom_00.png', 'category': 'custom'}})"
        )
        self.run_python(code, source, self.production, expected=1)
        self.assertEqual(source.read_bytes(), original)

    def test_invalid_scale_does_not_damage_production(self):
        for value in ("0", "-1", "nan", "inf"):
            self.run_tool("scale_overlay.py", "--folder", self.frames, "--scale", value, expected=1)
        self.assertEqual(self.snapshot(self.production), self.before)


if __name__ == "__main__":
    unittest.main()
