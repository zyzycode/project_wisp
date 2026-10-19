"""Replace the r14 hard inner-elbow mask with a support-aware smooth transition."""
import json
from pathlib import Path
import shutil
import subprocess

import numpy as np
from PIL import Image

from verify_elbow_overlap import verify

ROOT = Path(__file__).resolve().parents[1]
OLD = ROOT / 'work/arm-01/r14-width'
OUT = ROOT / 'work/arm-01/r15-elbow'


def convert(*args):
    subprocess.run(['convert', *map(str, args)], check=True)


def main():
    if (OUT / 'arm-01-r15-layers.psd2live').exists():
        raise RuntimeError('Preserve saved revision')
    native = OUT / 'native'
    native.mkdir(parents=True, exist_ok=True)
    for source in (OLD / 'native').glob('*.png'):
        shutil.copy2(source, native / source.name)
    upper = np.array(Image.open(native / 'upper_arm_L.png').convert('RGBA'))
    arm = np.array(Image.open(native / 'forearm_L-base.png').convert('RGBA'))
    matte = np.array(Image.open(OLD / 'elbow-overlap.pgm'))
    top = {}
    for x in range(upper.shape[1]):
        ys = np.flatnonzero(upper[:, x, 3] >= 250)
        if len(ys):
            top[x] = int(ys[0])
    # Change only the inner bend. Pixels outside the opaque shoulder support
    # and the lower elbow keep the previous mask. The original RGB is untouched.
    for y in range(100, 160):
        xs = np.flatnonzero(arm[y, :, 3] > 128)
        left, right = xs[0], xs[-1]
        for x in range(max(0, left-2), min(arm.shape[1], left+9)):
            ux, uy = x+228-110, y+145-242
            if x >= (left+right)/2 or ux not in top or not 0 <= uy < upper.shape[0]:
                continue
            if upper[uy, ux, 3] < 250:
                continue
            t = np.clip((uy-top[ux])/16, 0, 1)
            weight = t*t*(3-2*t)
            strip = np.clip((x-left-3)/4, 0, 1)
            matte[y, x] = round(255*(1-weight*(1-strip)))
    path = OUT / 'elbow-overlap.pgm'
    path.write_bytes(f'P5\n{matte.shape[1]} {matte.shape[0]}\n255\n'.encode()+matte.tobytes())
    convert(native / 'forearm_L-base.png', path, '-channel', 'A', '-fx', 'u*v.r', '+channel', native / 'forearm_L.png')
    layout = json.loads((OLD / 'layout.json').read_text())
    layout['name'] = 'ARM-01 r15 continuous elbow overlap'
    (OUT / 'layout.json').write_text(json.dumps(layout, indent=2)+'\n')
    cmd = ['-size', '440x380', 'xc:none']
    for layer in layout['layers']:
        r = layer['rect']
        cmd += [OUT / layer['image']['path'], '-geometry', f"+{r['left']}+{r['top']}", '-composite']
    convert(*cmd, OUT / 'prepared.png')
    result = verify(OUT)
    before = np.array(Image.open(OLD / 'native/forearm_L.png').convert('RGBA'))
    after = np.array(Image.open(native / 'forearm_L.png').convert('RGBA'))
    assert np.array_equal(before[:, :, :3], after[:, :, :3])
    changed = np.any(before != after, axis=2)
    ys, xs = np.where(changed)
    assert ys.min() >= 100 and ys.max() < 160
    assert np.array_equal(before[:60], after[:60])
    for y, x in zip(ys, xs):
        assert upper[y+145-242, x+228-110, 3] >= 250
    result.update(forearm_rgb_unchanged=True, wrist_pixels_unchanged=True,
                  changes_only_inside_opaque_shoulder=True,
                  changed_local_bbox=[int(xs.min()), int(ys.min()), int(xs.max()+1), int(ys.max()+1)],
                  changed_pixels=int(changed.sum()))
    (OUT / 'mask-verification.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
