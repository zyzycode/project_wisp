"""Verify requested exports and render reproducible pixel/anchor review artifacts."""
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from lib.config import PIPELINE_DIR, SPRITES_DIR
from preview_sprites import frames_to_gif


def verify():
    root = Path(PIPELINE_DIR)
    out = root / 'output' / 'refinement'
    proposal = json.loads((root/'output'/'manifest-proposal.json').read_text())
    entries = proposal['entries']
    boards = {name: Image.new('RGB', (1280, 7*340), color)
              for name, color in [('dark', '#303040'), ('light', '#e4e8ef')]}
    report = {}
    for row, (key, entry) in enumerate(entries.items()):
        paths, stats = [], []
        for index, frame in enumerate(entry['frames']):
            path = Path(SPRITES_DIR)/frame['source'].removeprefix('/assets/sprites/')
            image = Image.open(path)
            assert image.mode == 'RGBA' and image.size == (512, 512), path
            alpha = np.array(image.getchannel('A'))
            assert alpha.min() == 0 and alpha.max() >= 250, path
            assert not np.any(alpha[[0, -1], :]) and not np.any(alpha[:, [0, -1]]), path
            for point in [frame['pivot'], *frame['anchors'].values()]:
                assert 0 <= point['x'] < 512 and 0 <= point['y'] < 512, (path, point)
            paths.append(str(path))
            stats.append({'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                          'bounds': list(image.getbbox()), 'alphaRange': [int(alpha.min()), int(alpha.max())],
                          'pivot': frame['pivot']})
            for name, board in boards.items():
                shown = image.resize((300, 300), Image.Resampling.LANCZOS)
                board.paste(shown, (index*320+10, row*340+30), shown)
                draw = ImageDraw.Draw(board)
                draw.text((index*320+10, row*340+6), f'{key} / {index:02}',
                          fill='white' if name == 'dark' else 'black')
        frames_to_gif(paths, str(root/'output'/'previews'/f'preview_{key[5:]}.gif'),
                      fps=entry['fps'], bg_color=(48, 48, 64))
        report[key] = stats
    for name, board in boards.items():
        board.save(out/f'contact-{name}.png')
    # Shared boundary frames prove there is no artwork jump on these transitions.
    assert report['body_grab_edge'][3]['sha256'] == report['body_pull_up_edge'][0]['sha256']
    assert report['body_sit_edge'][1]['sha256'] == report['body_sit_edge_settle'][0]['sha256']
    assert report['body_sit_edge_settle'][3]['sha256'] == report['body_sit_edge_sleep'][0]['sha256']
    assert report['body_cursor_play'][0]['sha256'] == report['body_cursor_play'][3]['sha256']
    for key in ['body_sit_edge', 'body_sit_edge_sleep']:
        assert report[key][1]['sha256'] == report[key][3]['sha256']
        pivots = [frame['pivot'] for frame in entries[key]['frames']]
        assert max(p['x'] for p in pivots)-min(p['x'] for p in pivots) <= 1
        assert max(p['y'] for p in pivots)-min(p['y'] for p in pivots) <= 1
    (out/'verification.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(f'Verified {sum(map(len, report.values()))} PNGs and transition/loop boundaries')


if __name__ == '__main__':
    verify()
