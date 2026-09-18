"""Regressions for the reviewed September sprite geometry defects."""
import json
from hashlib import sha256
from pathlib import Path
import sys
import unittest

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'asset-pipeline' / 'scripts'))
from lib.reviewed_extraction import extract_reviewed
from normalize_reviewed import bake_face, place, replace_entries


class NormalizedAssetsTests(unittest.TestCase):
    def test_look_around_uses_a_complete_generated_pack_without_face_decals(self):
        recipe = json.loads((ROOT / 'asset-pipeline/references/normalization-2026-09.json').read_text())
        spec = recipe['animations']['body_look_around']
        self.assertIn('sheet', spec)
        self.assertTrue(spec['sheet'].startswith('asset-pipeline/generated_images/'))
        self.assertEqual(sha256((ROOT / spec['sheet']).read_bytes()).hexdigest(), spec['sheetSha256'])
        self.assertEqual(len(spec['frames']), 4)
        for frame in spec['frames']:
            self.assertNotIn('bakedFace', frame)

    def test_surface_touch_is_sliced_from_a_generated_pack_with_faces(self):
        recipe = json.loads((ROOT / 'asset-pipeline/references/normalization-2026-09.json').read_text())
        spec = recipe['animations']['body_surface_touch']
        self.assertIn('sheet', spec)
        self.assertTrue(spec['sheet'].startswith('asset-pipeline/generated_images/'))
        self.assertTrue((ROOT / spec['sheet']).is_file())
        self.assertIn('sheetSha256', spec)
        self.assertEqual(sha256((ROOT / spec['sheet']).read_bytes()).hexdigest(), spec['sheetSha256'])
        for frame in spec['frames']:
            self.assertNotIn('bakedFace', frame)

    def test_crouching_poses_have_no_independent_face_track(self):
        manifest = json.loads((ROOT / 'public/assets/sprites/manifest.json').read_text())
        for key in ('body_crouch_examine', 'body_surface_touch'):
            with self.subTest(key=key):
                body = manifest[key]
                self.assertEqual(body['faceOverlay'], {'mode': 'baked_in', 'fallback': 'none'})
                self.assertNotIn('face', body.get('defaultAnchors', {}))
                for meta in body.get('frameMeta', []):
                    self.assertNotIn('face', meta.get('anchors', {}))

    def test_looking_and_leg_swinging_have_only_baked_faces(self):
        manifest = json.loads((ROOT / 'public/assets/sprites/manifest.json').read_text())
        for key in ('body_look_around', 'body_sit', 'body_sit_edge', 'body_sit_edge_settle', 'body_sit_edge_sleep'):
            with self.subTest(key=key):
                self.assertEqual(manifest[key]['faceOverlay'], {'mode': 'baked_in', 'fallback': 'none'})
        look = manifest['body_look_around']
        self.assertNotIn('face', look.get('defaultAnchors', {}))
        for frame in look.get('frameMeta', []):
            self.assertNotIn('face', frame.get('anchors', {}))

    def test_baked_eyes_are_pixels_in_every_look_and_sit_frame(self):
        manifest = json.loads((ROOT / 'public/assets/sprites/manifest.json').read_text())
        for key in ('body_look_around', 'body_sit'):
            for source in manifest[key]['frames']:
                with Image.open(ROOT / 'public' / source.lstrip('/')) as image:
                    pixels = np.array(image)
                    # Eyelashes are dark pixels in the upper face, above the
                    # bows/clothes. Empty face source sheets have none here.
                    mask = ((pixels[:, :, :3].max(axis=2) < 90) & (pixels[:, :, 3] > 128))
                    region = mask[155:205, 202:307] if key == 'body_look_around' else mask[270:312, 202:307]
                    self.assertGreater(np.count_nonzero(region), 30, source)

    def test_baking_changes_only_the_attached_expression_region(self):
        body = Image.new('RGBA', (512, 512), (240, 180, 160, 255))
        body.putpixel((230, 175), (240, 180, 160, 128))
        face = Image.new('RGBA', (512, 512))
        face.putpixel((256, 180), (10, 20, 30, 255))
        baked = bake_face(body, face, {'x': 230, 'y': 175})
        self.assertEqual(baked.getpixel((230, 175)), (10, 20, 30, 128))
        self.assertEqual(baked.getpixel((256, 180)), body.getpixel((256, 180)))
        self.assertEqual(baked.getchannel('A').tobytes(), body.getchannel('A').tobytes())

    def test_jump_frames_contain_a_character_not_detached_motion_marks(self):
        manifest = json.loads((ROOT / 'public/assets/sprites/manifest.json').read_text())
        for frame in manifest['body_jump']['frames']:
            source = frame if isinstance(frame, str) else frame['source']
            with Image.open(ROOT / 'public' / source.lstrip('/')) as image:
                self.assertGreater(np.count_nonzero(np.array(image)[:, :, 3] > 128), 12000, source)

    def test_regenerated_pose_packs_have_faces_without_overlay_anchors(self):
        manifest = json.loads((ROOT / 'public/assets/sprites/manifest.json').read_text())
        recipe = json.loads((ROOT / 'asset-pipeline/references/normalization-2026-09.json').read_text())
        for key in ('body_lie', 'body_crouch_examine', 'body_sit', 'body_sit_edge', 'body_stand_up'):
            with self.subTest(key=key):
                body = manifest[key]
                self.assertEqual(body['faceOverlay'], {'mode': 'baked_in', 'fallback': 'none'})
                self.assertNotIn('face', body.get('defaultAnchors', {}))
                for frame in body.get('frameMeta', []) + body['frames']:
                    if isinstance(frame, dict):
                        self.assertNotIn('face', frame.get('anchors', {}))
                spec = recipe['animations'][key]
                self.assertTrue(spec['sheet'].startswith('asset-pipeline/generated_images/'))
                self.assertEqual(sha256((ROOT / spec['sheet']).read_bytes()).hexdigest(), spec['sheetSha256'])
                self.assertEqual(len(spec['frames']), 4)
                for frame in spec['frames']:
                    self.assertNotIn('bakedFace', frame)

    def test_thick_touching_fringe_keeps_four_complete_characters(self):
        sheet = Image.new('RGBA', (440, 150))
        for index in range(4):
            sheet.paste((200, 100, 130, 255), (index*110+10, 10, index*110+95, 140))
        for index in range(3):
            sheet.paste((200, 100, 130, 255), (index*110+95, 65, index*110+120, 78))
        self.assertEqual(len(extract_reviewed(sheet)), 4)

    def test_resampling_preserves_alpha_and_rejects_clipping(self):
        image = Image.new('RGBA', (100, 100), (200, 100, 130, 128))
        placed, point = place(image, 2, [50, 100], [256, 460])
        self.assertEqual(placed.getpixel((256, 400))[3], 128)
        self.assertEqual(point([50, 100]), {'x': 256, 'y': 460})
        with self.assertRaisesRegex(ValueError, 'Clipping'):
            place(image, 6, [50, 100], [256, 460])

    def test_registration_preserves_unrelated_handwritten_metadata(self):
        original = '{\n  "body_sit": {"frames": []},\n  "unrelated": { "fps": 7, "note": "keep" }\n}\n'
        updated = replace_entries(original, {'body_sit': {'frames': [], 'fps': 5}})
        self.assertIn('  "unrelated": { "fps": 7, "note": "keep" }', updated)
        self.assertEqual(json.loads(updated)['body_sit']['fps'], 5)


if __name__ == '__main__':
    unittest.main()
