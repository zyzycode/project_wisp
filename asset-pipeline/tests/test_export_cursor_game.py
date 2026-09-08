import sys
from pathlib import Path
import unittest

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
from export_cursor_game import align_feet, sole_bounds


class CursorFeetTests(unittest.TestCase):
    def test_arm_extension_does_not_shift_planted_feet(self):
        first = Image.new('RGBA', (300, 400))
        draw = ImageDraw.Draw(first)
        draw.rectangle((100, 30, 190, 360), fill='pink')
        draw.rectangle((110, 365, 140, 390), fill='black')
        draw.rectangle((150, 365, 180, 390), fill='black')
        reaching = first.copy()
        ImageDraw.Draw(reaching).rectangle((20, 160, 100, 185), fill='pink')
        a, b = align_feet(first, 1), align_feet(reaching, 1)
        self.assertEqual(sole_bounds(a), sole_bounds(b))
        self.assertEqual(sole_bounds(a)[3], 462)
        self.assertEqual(a.crop((0, 420, 512, 512)).tobytes(), b.crop((0, 420, 512, 512)).tobytes())


if __name__ == '__main__':
    unittest.main()
