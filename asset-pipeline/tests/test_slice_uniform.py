import os
import sys
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))
from slice_uniform import slice_strip, isolate_characters


class UniformSlicingTests(unittest.TestCase):
    def test_separates_unevenly_spaced_characters(self):
        sheet = Image.new("RGBA", (600, 100))
        for left in (5, 90, 270, 490):
            sheet.paste((200, 50, 80, 255), (left, 10, left + 60, 90))
        frames = isolate_characters(sheet, 4)
        self.assertEqual([frame.size for frame in frames], [(60, 80)] * 4)

    def test_rejects_opaque_background(self):
        with tempfile.TemporaryDirectory() as folder:
            source = os.path.join(folder, "source.png")
            Image.new("RGB", (400, 100), "white").save(source)
            with self.assertRaisesRegex(ValueError, "transparent"):
                slice_strip(source, "body_test")

    def test_preserves_alpha_and_exports_four_frames(self):
        with tempfile.TemporaryDirectory() as folder:
            source = os.path.join(folder, "source.png")
            sheet = Image.new("RGBA", (400, 100))
            for index in range(4):
                sheet.paste((200, 50, 80, 128), (index * 100 + 30, 20, index * 100 + 70, 80))
            sheet.save(source)
            def destination(path, **kwargs):
                os.makedirs(os.path.dirname(path), exist_ok=True)
                return path
            with patch("slice_uniform.SPRITES_DIR", folder), patch("slice_uniform.prepare_sprite_file", destination):
                paths = slice_strip(source, "body_test")
                self.assertEqual(len(paths), 4)
                with Image.open(paths[0]) as frame:
                    self.assertEqual(frame.size, (512, 512))
                    self.assertEqual(frame.getpixel((256, 250))[3], 128)
                with self.assertRaisesRegex(ValueError, "replace"):
                    slice_strip(source, "body_test")


if __name__ == "__main__":
    unittest.main()
