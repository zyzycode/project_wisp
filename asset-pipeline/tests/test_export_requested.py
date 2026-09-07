import os
import sys
import unittest

from PIL import Image

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scripts'))
from export_requested import place_frame
from lib.reviewed_extraction import extract_reviewed


class LandmarkExportTests(unittest.TestCase):
    def test_touching_alpha_fringe_does_not_merge_characters(self):
        sheet = Image.new('RGBA', (420, 100))
        for index in range(4):
            sheet.paste((200, 100, 130, 255), (index*100+10, 10, index*100+80, 90))
        for index in range(3):
            sheet.paste((200, 100, 130, 40), (index*100+80, 49, index*100+110, 51))
        frames = extract_reviewed(sheet)
        self.assertEqual(len(frames), 4)
        self.assertTrue(all(frame.width < 110 for frame in frames))
        self.assertTrue(all(frame.getchannel('A').getextrema()[1] == 255 for frame in frames))

    def test_raised_hand_does_not_shrink_head_and_contact_is_preserved(self):
        body = Image.new('RGBA', (180, 400), (200, 100, 130, 255))
        _, transform, scale = place_frame(body, [90, 50], [90, 190], [90, 0], [256, 50])
        self.assertEqual(scale, 1)
        self.assertEqual(transform([90, 0]), {'x': 256, 'y': 50})
        self.assertEqual(transform([90, 190])['y']-transform([90, 50])['y'], 140)

    def test_clipping_is_rejected_before_export(self):
        body = Image.new('RGBA', (180, 600), (200, 100, 130, 255))
        with self.assertRaisesRegex(ValueError, 'Clipping'):
            place_frame(body, [90, 50], [90, 190], [90, 0], [256, 50])


if __name__ == '__main__':
    unittest.main()
