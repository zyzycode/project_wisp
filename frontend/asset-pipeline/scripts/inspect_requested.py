"""Produce contact sheets for manual landmark review of requested sprites."""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

from lib.config import PIPELINE_DIR
from lib.reviewed_extraction import extract_reviewed


def inspect():
    root = Path(PIPELINE_DIR)
    output = root / 'output' / 'refinement'
    output.mkdir(parents=True, exist_ok=True)
    actions = ['grab_edge', 'jump_travel', 'pull_up_edge', 'sit_edge',
               'sit_edge_settle', 'sit_edge_sleep', 'cursor_play']
    report = {}
    for action in actions:
        key = 'body_' + action
        source = root / 'generated_images' / (key + '.png')
        refined = root / 'generated_images' / 'refined' / (key + '.png')
        if refined.exists():
            source = refined
        if action == 'sit_edge_sleep':
            source = root / 'generated_images' / 'refined' / (key + '_short.png')
        if action == 'sit_edge_settle':
            source = root / 'generated_images' / 'refined' / (key + '_spaced.png')
        frames = extract_reviewed(Image.open(source), 4)
        board = Image.new('RGB', (1280, 550), '#303040')
        draw = ImageDraw.Draw(board)
        items = []
        for index, frame in enumerate(frames):
            pixels = np.array(frame).astype(int)
            r, g, b, alpha = np.moveaxis(pixels, 2, 0)
            skin = (r > 210) & (g > 160) & (r-g > 8) & (g-b > 3) & (alpha > 100)
            labels, _ = ndimage.label(skin)
            sizes = np.bincount(labels.ravel())
            sizes[0] = 0
            yy, xx = np.where(labels == sizes.argmax())
            box = [int(xx.min()), int(yy.min()), int(xx.max()+1), int(yy.max()+1)]
            scale = min(300 / frame.width, 490 / frame.height)
            shown = frame.resize((round(frame.width*scale), round(frame.height*scale)))
            x = index*320 + (320-shown.width)//2
            board.paste(shown, (x, 35), shown)
            draw.text((index*320+5, 5), f'{index}: {frame.width}x{frame.height} face={box}', fill='white')
            draw.rectangle((x+box[0]*scale, 35+box[1]*scale,
                            x+box[2]*scale, 35+box[3]*scale), outline='cyan', width=2)
            frame.save(output / f'{key}_source_{index}.png')
            items.append({'size': list(frame.size), 'faceBox': box})
        board.save(output / f'{key}_landmarks.png')
        report[key] = {'source': str(source.relative_to(root)), 'frames': items}
    (output / 'landmarks-auto.json').write_text(json.dumps(report, indent=2))


if __name__ == '__main__':
    inspect()
