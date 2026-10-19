"""Regression for the abrupt alpha-mask notch at the r14 inner elbow."""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]


def verify(directory):
    arm = np.array(Image.open(directory / 'native/forearm_L-base.png').convert('RGBA'))
    mask = np.array(Image.open(directory / 'elbow-overlap.pgm'))
    # Follow the same inner-contour strip through the shoulder overlap.
    samples = [int(mask[y, np.flatnonzero(arm[y, :, 3] > 128)[0]+2]) for y in range(120, 151)]
    step = int(np.abs(np.diff(samples)).max())
    assert step <= 32, f'Inner elbow alpha mask jumps {step}/255 in one row (limit 32)'
    assert samples[0] == 255 and samples[-1] == 0, 'Preserve exposed edge and remove covered outline'
    before = np.array(Image.open(ROOT / 'work/arm-01/r14-width/prepared.png').convert('RGBA'))
    after = np.array(Image.open(directory / 'prepared.png').convert('RGBA'))
    assert np.array_equal(before[:, :, 3] >= 128, after[:, :, 3] >= 128), 'Arm silhouette changed'
    delta = np.abs(before.astype(int)-after.astype(int))
    assert delta[:, :, 3].max() <= 2, 'Opacity changed beyond near-opaque overlap'
    assert not np.any(delta[:245]) and not np.any(delta[305:]), 'Changed pixels outside inner bend'
    return {'inner_edge_max_alpha_mask_step': step, 'limit': 32, 'samples_y120_to150': samples,
            'composite_half_alpha_silhouette_unchanged': True,
            'composite_max_alpha_difference': int(delta[:, :, 3].max())}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path)
    args = parser.parse_args()
    print(json.dumps(verify(args.directory)))
