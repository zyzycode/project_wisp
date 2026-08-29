#!/usr/bin/env python3
"""
Unit tests for Sprite & Manifest Validator (scripts/validate_manifest.py)
"""

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from scripts.validate_manifest import SpriteValidator, ValidationIssue, ValidationReport


class TestSpriteValidator(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp(prefix="wisp_test_sprites_")
        self.public_dir = os.path.join(self.test_dir, "public")
        self.sprites_dir = os.path.join(self.public_dir, "assets", "sprites")
        self.manifest_path = os.path.join(self.sprites_dir, "manifest.json")
        self.quarantine_dir = os.path.join(self.sprites_dir, ".quarantine")

        os.makedirs(os.path.join(self.sprites_dir, "body", "idle"), exist_ok=True)
        os.makedirs(os.path.join(self.sprites_dir, "faces", "happy"), exist_ok=True)

        # Create dummy png files
        for i in range(4):
            with open(os.path.join(self.sprites_dir, "body", "idle", f"body_idle_{i:02d}.png"), "wb") as f:
                f.write(b"\x89PNG\r\n\x1a\nDummyPNGData")
            with open(os.path.join(self.sprites_dir, "faces", "happy", f"face_happy_{i:02d}.png"), "wb") as f:
                f.write(b"\x89PNG\r\n\x1a\nDummyPNGData")

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def _write_manifest(self, data: dict):
        with open(self.manifest_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    def test_valid_manifest_passes_validation(self):
        manifest_data = {
            "body_idle": {
                "category": "body/idle",
                "framesCount": 4,
                "frames": [
                    "/assets/sprites/body/idle/body_idle_00.png",
                    "/assets/sprites/body/idle/body_idle_01.png",
                    "/assets/sprites/body/idle/body_idle_02.png",
                    "/assets/sprites/body/idle/body_idle_03.png",
                ],
                "faceOverlay": {
                    "mode": "baked_in",
                    "fallback": "none",
                },
            },
            "face_happy": {
                "category": "face/happy",
                "framesCount": 4,
                "frames": [
                    "/assets/sprites/faces/happy/face_happy_00.png",
                    "/assets/sprites/faces/happy/face_happy_01.png",
                    "/assets/sprites/faces/happy/face_happy_02.png",
                    "/assets/sprites/faces/happy/face_happy_03.png",
                ],
            },
        }
        self._write_manifest(manifest_data)

        validator = SpriteValidator(
            project_root=self.test_dir,
            sprites_dir=self.sprites_dir,
            manifest_path=self.manifest_path,
        )
        report = validator.validate()
        self.assertTrue(report.is_valid)
        self.assertEqual(len(report.errors), 0)
        self.assertEqual(report.registered_animations_count, 2)
        self.assertEqual(report.scanned_files_count, 8)

    def test_missing_asset_file_detected_as_error(self):
        manifest_data = {
            "body_idle": {
                "category": "body/idle",
                "framesCount": 1,
                "frames": [
                    "/assets/sprites/body/idle/non_existent_file.png",
                ],
                "faceOverlay": {"mode": "baked_in", "fallback": "none"},
            }
        }
        self._write_manifest(manifest_data)

        validator = SpriteValidator(
            project_root=self.test_dir,
            sprites_dir=self.sprites_dir,
            manifest_path=self.manifest_path,
        )
        report = validator.validate()
        self.assertFalse(report.is_valid)
        codes = [e.code for e in report.errors]
        self.assertIn("MISSING_ASSET_FILE", codes)

    def test_frames_count_mismatch_detected_as_error(self):
        manifest_data = {
            "body_idle": {
                "category": "body/idle",
                "framesCount": 8,  # Declares 8 but only gives 4
                "frames": [
                    "/assets/sprites/body/idle/body_idle_00.png",
                    "/assets/sprites/body/idle/body_idle_01.png",
                    "/assets/sprites/body/idle/body_idle_02.png",
                    "/assets/sprites/body/idle/body_idle_03.png",
                ],
                "faceOverlay": {"mode": "baked_in", "fallback": "none"},
            }
        }
        self._write_manifest(manifest_data)

        validator = SpriteValidator(
            project_root=self.test_dir,
            sprites_dir=self.sprites_dir,
            manifest_path=self.manifest_path,
        )
        report = validator.validate()
        self.assertFalse(report.is_valid)
        codes = [e.code for e in report.errors]
        self.assertIn("FRAMES_COUNT_MISMATCH", codes)

    def test_body_missing_face_overlay_detected_as_error(self):
        manifest_data = {
            "body_idle": {
                "category": "body/idle",
                "framesCount": 4,
                "frames": [
                    "/assets/sprites/body/idle/body_idle_00.png",
                    "/assets/sprites/body/idle/body_idle_01.png",
                    "/assets/sprites/body/idle/body_idle_02.png",
                    "/assets/sprites/body/idle/body_idle_03.png",
                ],
                # Missing faceOverlay
            }
        }
        self._write_manifest(manifest_data)

        validator = SpriteValidator(
            project_root=self.test_dir,
            sprites_dir=self.sprites_dir,
            manifest_path=self.manifest_path,
        )
        report = validator.validate()
        self.assertFalse(report.is_valid)
        codes = [e.code for e in report.errors]
        self.assertIn("MISSING_FACE_OVERLAY", codes)

    def test_non_body_declaring_face_overlay_is_forbidden(self):
        manifest_data = {
            "face_happy": {
                "category": "face/happy",
                "framesCount": 4,
                "frames": [
                    "/assets/sprites/faces/happy/face_happy_00.png",
                    "/assets/sprites/faces/happy/face_happy_01.png",
                    "/assets/sprites/faces/happy/face_happy_02.png",
                    "/assets/sprites/faces/happy/face_happy_03.png",
                ],
                "faceOverlay": {"mode": "baked_in", "fallback": "none"},  # Forbidden on face_*
            }
        }
        self._write_manifest(manifest_data)

        validator = SpriteValidator(
            project_root=self.test_dir,
            sprites_dir=self.sprites_dir,
            manifest_path=self.manifest_path,
        )
        report = validator.validate()
        self.assertFalse(report.is_valid)
        codes = [e.code for e in report.errors]
        self.assertIn("FORBIDDEN_FACE_OVERLAY_ON_NON_BODY", codes)

    def test_baked_in_mode_forbidden_properties(self):
        manifest_bad_baked = {
            "body_idle": {
                "category": "body/idle",
                "frames": ["/assets/sprites/body/idle/body_idle_00.png"],
                "faceOverlay": {
                    "mode": "baked_in",
                    "allowedFaceKeys": ["face_happy"],  # Forbidden in baked_in
                    "fallback": "face_happy",  # Forbidden: must be 'none'
                    "anchor": "face",  # Forbidden in baked_in
                },
            }
        }
        self._write_manifest(manifest_bad_baked)
        validator = SpriteValidator(self.test_dir, self.sprites_dir, self.manifest_path)
        report = validator.validate()
        self.assertFalse(report.is_valid)
        codes = [e.code for e in report.errors]
        self.assertIn("INVALID_BAKED_FALLBACK", codes)
        self.assertIn("FORBIDDEN_ALLOWED_KEYS_IN_BAKED", codes)
        self.assertIn("FORBIDDEN_ANCHOR_IN_BAKED", codes)

    def test_overlay_mode_validation_rules(self):
        # 1. Overlay without allowedFaceKeys -> Error
        manifest_bad_allowed = {
            "body_idle": {
                "category": "body/idle",
                "frames": ["/assets/sprites/body/idle/body_idle_00.png"],
                "faceOverlay": {
                    "mode": "overlay",
                    "allowedFaceKeys": [],
                    "anchor": "face",
                    "fallback": "none",
                },
                "defaultAnchors": {"face": {"x": 256, "y": 126}},
            }
        }
        self._write_manifest(manifest_bad_allowed)
        validator = SpriteValidator(self.test_dir, self.sprites_dir, self.manifest_path)
        report = validator.validate()
        self.assertIn("EMPTY_ALLOWED_FACE_KEYS", [e.code for e in report.errors])

        # 2. Overlay with missing anchor definition -> Error
        manifest_missing_anchor = {
            "face_happy": {
                "category": "face/happy",
                "frames": ["/assets/sprites/faces/happy/face_happy_00.png"],
            },
            "body_idle": {
                "category": "body/idle",
                "frames": ["/assets/sprites/body/idle/body_idle_00.png"],
                "faceOverlay": {
                    "mode": "overlay",
                    "allowedFaceKeys": ["face_happy"],
                    "anchor": "face_missing_anchor",
                    "fallback": "face_happy",
                },
                # defaultAnchors missing 'face_missing_anchor'
            },
        }
        self._write_manifest(manifest_missing_anchor)
        validator = SpriteValidator(self.test_dir, self.sprites_dir, self.manifest_path)
        report = validator.validate()
        self.assertIn("UNRESOLVED_FACE_ANCHOR", [e.code for e in report.errors])

        # 3. Overlay with valid anchor and allowed keys -> Valid
        manifest_valid_overlay = {
            "face_happy": {
                "category": "face/happy",
                "frames": ["/assets/sprites/faces/happy/face_happy_00.png"],
            },
            "body_idle": {
                "category": "body/idle",
                "frames": ["/assets/sprites/body/idle/body_idle_00.png"],
                "defaultAnchors": {"face": {"x": 256, "y": 126}},
                "faceOverlay": {
                    "mode": "overlay",
                    "allowedFaceKeys": ["face_happy"],
                    "anchor": "face",
                    "fallback": "face_happy",
                },
            },
        }
        self._write_manifest(manifest_valid_overlay)
        validator = SpriteValidator(self.test_dir, self.sprites_dir, self.manifest_path)
        report = validator.validate()
        self.assertTrue(report.is_valid)

    def test_path_traversal_rejected(self):
        manifest_traversal = {
            "body_idle": {
                "category": "body/idle",
                "frames": ["/assets/sprites/body/idle/../../secret.png"],
                "faceOverlay": {"mode": "baked_in", "fallback": "none"},
            }
        }
        self._write_manifest(manifest_traversal)
        validator = SpriteValidator(self.test_dir, self.sprites_dir, self.manifest_path)
        report = validator.validate()
        self.assertFalse(report.is_valid)
        self.assertIn("PATH_TRAVERSAL_FORBIDDEN", [e.code for e in report.errors])

    def test_update_manifest_preserves_manual_metadata(self):
        initial_manifest = {
            "body_idle": {
                "category": "body/idle",
                "framesCount": 1,
                "frames": ["/assets/sprites/body/idle/body_idle_00.png"],
                "pivot": {"x": 256, "y": 460},
                "canvasSize": {"width": 512, "height": 512},
                "fps": 8,
                "defaultAnchors": {"face": {"x": 256, "y": 126}},
                "frameMeta": [{"anchors": {"face": {"x": 256, "y": 124}}}],
                "faceOverlay": {"mode": "baked_in", "fallback": "none"},
                "emotionalTone": "neutral",
                "tags": ["idle", "breathing"],
                "sourceFile": "custom_artist_source.png",
            }
        }
        self._write_manifest(initial_manifest)

        validator = SpriteValidator(
            project_root=self.test_dir,
            sprites_dir=self.sprites_dir,
            manifest_path=self.manifest_path,
        )

        success, msg, output = validator.update_manifest(quarantine_orphans=False)
        self.assertTrue(success)

        # Check updated on disk
        with open(self.manifest_path, "r", encoding="utf-8") as f:
            updated = json.load(f)

        body_idle = updated["body_idle"]
        # Frames updated to match all 4 on-disk files
        self.assertEqual(body_idle["framesCount"], 4)
        self.assertEqual(len(body_idle["frames"]), 4)

        # All manual metadata strictly preserved:
        self.assertEqual(body_idle["pivot"], {"x": 256, "y": 460})
        self.assertEqual(body_idle["canvasSize"], {"width": 512, "height": 512})
        self.assertEqual(body_idle["fps"], 8)
        self.assertEqual(body_idle["defaultAnchors"], {"face": {"x": 256, "y": 126}})
        self.assertEqual(body_idle["frameMeta"], [{"anchors": {"face": {"x": 256, "y": 124}}}])
        self.assertEqual(body_idle["faceOverlay"], {"mode": "baked_in", "fallback": "none"})
        self.assertEqual(body_idle["emotionalTone"], "neutral")
        self.assertEqual(body_idle["tags"], ["idle", "breathing"])
        self.assertEqual(body_idle["sourceFile"], "custom_artist_source.png")

    def test_idempotent_multiple_runs(self):
        validator = SpriteValidator(
            project_root=self.test_dir,
            sprites_dir=self.sprites_dir,
            manifest_path=self.manifest_path,
        )

        validator.update_manifest()
        with open(self.manifest_path, "r", encoding="utf-8") as f:
            first_run = f.read()

        validator.update_manifest()
        with open(self.manifest_path, "r", encoding="utf-8") as f:
            second_run = f.read()

        self.assertEqual(first_run, second_run)

    def test_quarantine_orphaned_files_moves_instead_of_deleting(self):
        # Create an orphaned file
        orphan_dir = os.path.join(self.sprites_dir, "custom", "orphan")
        os.makedirs(orphan_dir, exist_ok=True)
        orphan_file = os.path.join(orphan_dir, "orphan_00.png")
        with open(orphan_file, "wb") as f:
            f.write(b"\x89PNG\r\n\x1a\nOrphanData")

        manifest_data = {
            "body_idle": {
                "category": "body/idle",
                "framesCount": 4,
                "frames": [
                    "/assets/sprites/body/idle/body_idle_00.png",
                    "/assets/sprites/body/idle/body_idle_01.png",
                    "/assets/sprites/body/idle/body_idle_02.png",
                    "/assets/sprites/body/idle/body_idle_03.png",
                ],
                "faceOverlay": {"mode": "baked_in", "fallback": "none"},
            }
        }
        self._write_manifest(manifest_data)

        validator = SpriteValidator(
            project_root=self.test_dir,
            sprites_dir=self.sprites_dir,
            manifest_path=self.manifest_path,
            quarantine_dir=self.quarantine_dir,
        )

        # Update with quarantine: orphan moved to quarantine directory, not deleted
        validator.update_manifest(quarantine_orphans=True)
        self.assertFalse(os.path.exists(orphan_file))
        quarantined_files = os.listdir(self.quarantine_dir)
        self.assertTrue(len(quarantined_files) > 0)
        self.assertTrue(any("orphan_00.png" in f for f in quarantined_files))

    def test_cli_exit_code_zero_on_pass_nonzero_on_error(self):
        valid_manifest = {
            "body_idle": {
                "category": "body/idle",
                "framesCount": 4,
                "frames": [
                    "/assets/sprites/body/idle/body_idle_00.png",
                    "/assets/sprites/body/idle/body_idle_01.png",
                    "/assets/sprites/body/idle/body_idle_02.png",
                    "/assets/sprites/body/idle/body_idle_03.png",
                ],
                "faceOverlay": {"mode": "baked_in", "fallback": "none"},
            }
        }
        self._write_manifest(valid_manifest)

        # Run CLI with valid manifest
        cmd_valid = [
            "python3",
            "scripts/validate_manifest.py",
            "--check",
            "--manifest",
            self.manifest_path,
            "--sprites-dir",
            self.sprites_dir,
        ]
        res_valid = subprocess.run(cmd_valid, capture_output=True, text=True)
        self.assertEqual(res_valid.returncode, 0)

        # Break manifest
        invalid_manifest = {
            "body_idle": {
                "category": "body/idle",
                "frames": ["/assets/sprites/body/idle/missing_file.png"],
                "faceOverlay": {"mode": "baked_in", "fallback": "none"},
            }
        }
        self._write_manifest(invalid_manifest)

        cmd_invalid = [
            "python3",
            "scripts/validate_manifest.py",
            "--check",
            "--manifest",
            self.manifest_path,
            "--sprites-dir",
            self.sprites_dir,
        ]
        res_invalid = subprocess.run(cmd_invalid, capture_output=True, text=True)
        self.assertEqual(res_invalid.returncode, 1)


if __name__ == "__main__":
    unittest.main()
