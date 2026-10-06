"""Slice six-frame cursor reactions, align planted feet and export PNG/metadata."""
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from lib.config import PIPELINE_DIR, SPRITES_DIR
from lib.output_paths import prepare_output_file, prepare_sprite_file
from lib.reviewed_extraction import extract_reviewed
from preview_sprites import frames_to_gif


def sole_bounds(image):
    data = np.array(image)
    mask = (data[:, :, :3].max(axis=2) < 80) & (data[:, :, 3] > 128)
    visible_y = np.where(data[:, :, 3] > 128)[0]
    if not len(visible_y):
        raise ValueError('Empty frame')
    shoe_top = visible_y.min() + .91*(visible_y.max()+1-visible_y.min())
    mask[:int(shoe_top)] = False
    yy, xx = np.where(mask)
    if not len(xx):
        raise ValueError('Cannot identify planted dark shoes')
    return (int(xx.min()), int(yy.min()), int(xx.max()+1), int(yy.max()+1))


def align_feet(image, scale):
    resized = image.resize((round(image.width*scale), round(image.height*scale)), Image.Resampling.LANCZOS)
    left, _, right, bottom = sole_bounds(resized)
    offset = (round(256-(left+right)/2), 462-bottom)
    box = resized.getbbox()
    if min(box[0]+offset[0], box[1]+offset[1]) < 4 or max(box[2]+offset[0], box[3]+offset[1]) > 508:
        raise ValueError('Clipped frame')
    canvas = Image.new('RGBA', (512, 512))
    canvas.alpha_composite(resized, offset)
    return canvas


def export():
    root = Path(PIPELINE_DIR)
    out = root/'output'/'cursor_game'
    reference = Path(SPRITES_DIR)/'body'/'cursor_play'/'body_cursor_play_00.png'
    reference_image = Image.open(reference)
    ref_alpha = np.array(reference_image.getchannel('A'))
    reference_height = sole_bounds(reference_image)[3] - int(np.where(ref_alpha > 128)[0].min())
    boards = {name: Image.new('RGB', (1536, 2*552), color)
              for name, color in [('dark', '#303040'), ('light', '#e4e8ef')]}
    entries, report = {}, {}
    for row, action in enumerate(['caught', 'missed']):
        key = 'body_cursor_'+action
        source = root/'generated_images'/'cursor_game'/f'{key}.png'
        sheet = Image.open(source)
        if sheet.mode != 'RGBA' or sheet.getchannel('A').getextrema()[0] != 0:
            raise ValueError(f'Expected true transparent source: {source}')
        frames = []
        for strip in range(2):
            frames.extend(extract_reviewed(sheet.crop((0, round(strip*sheet.height/2),
                                                      sheet.width, round((strip+1)*sheet.height/2))), 3))
        heights = [sole_bounds(frame)[3]-int(np.where(np.array(frame.getchannel('A')) > 128)[0].min())
                   for frame in frames]
        scale = reference_height / float(np.median(heights))
        definitions, paths, stats = [], [], []
        for index, frame in enumerate(frames):
            canvas = align_feet(frame, scale)
            path = Path(SPRITES_DIR)/'body'/f'cursor_{action}'/f'{key}_{index:02d}.png'
            canvas.save(prepare_sprite_file(str(path), sources=[source, reference]))
            box = canvas.getbbox()
            alpha = np.array(canvas.getchannel('A'))
            assert alpha.min() == 0 and alpha.max() >= 250
            assert not np.any(alpha[[0, -1], :]) and not np.any(alpha[:, [0, -1]])
            pivot = {'x': 256, 'y': 460}
            definitions.append({'source': '/assets/sprites/'+path.relative_to(SPRITES_DIR).as_posix(),
                                'durationMs': 100, 'pivot': pivot, 'anchors': {'root': pivot},
                                'bounds': {'x': box[0], 'y': box[1], 'width': box[2]-box[0], 'height': box[3]-box[1]}})
            stats.append({'file': path.name, 'soleBounds': sole_bounds(canvas), 'bounds': box})
            paths.append(str(path))
            for name, board in boards.items():
                shown = canvas.resize((256, 256), Image.Resampling.LANCZOS)
                xy = ((index%3)*512+128, row*552+(index//3)*266+24)
                board.paste(shown, xy, shown)
                ImageDraw.Draw(board).text((xy[0], xy[1]-18), f'{key} / {index:02d}',
                                          fill='white' if name == 'dark' else 'black')
        widths = [item['soleBounds'][2]-item['soleBounds'][0] for item in stats]
        assert max(widths)-min(widths) <= 3, widths
        assert all(abs((item['soleBounds'][0]+item['soleBounds'][2])/2-256) <= .5 for item in stats)
        assert all(item['soleBounds'][3] == 462 for item in stats)
        entries[key] = {'category': 'body/cursor_'+action, 'framesCount': 6, 'fps': 10,
                        'canvasSize': {'width': 512, 'height': 512}, 'pivot': {'x': 256, 'y': 460},
                        'faceOverlay': {'mode': 'baked_in', 'fallback': 'none'}, 'frames': definitions}
        report[key] = {'scale': scale, 'durationMs': 600, 'frames': stats}
        frames_to_gif(paths, str(prepare_output_file(str(out/f'{key}.gif'))), fps=10)
    for name, board in boards.items():
        board.save(prepare_output_file(str(out/f'contact-{name}.png')))
    for name, data in [('manifest-proposal.json', {'kind': 'wisp-asset-proposal',
                        'exportTarget': 'public/assets/sprites', 'entries': entries}), ('verification.json', report)]:
        prepare_output_file(str(out/name)).write_text(json.dumps(data, indent=2), encoding='utf-8')
    print('Exported and verified 12 RGBA frames: two 600 ms clips')


if __name__ == '__main__':
    export()
