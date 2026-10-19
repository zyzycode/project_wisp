"""Explicit local geometry correction of r13; preserve accepted wrist textures."""
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OLD = ROOT / 'work/arm-01/r13-arm'
OUT = ROOT / 'work/arm-01/r14-width'


def convert(*args):
    subprocess.run(['convert', *map(str, args)], check=True)


def main():
    if (OUT / 'arm-01-r14-layers.psd2live').exists():
        raise RuntimeError('Preserve saved revision')
    native = OUT / 'native'
    native.mkdir(parents=True, exist_ok=True)
    # Keep the lower shoulder contour fixed; enlarge thickness upwards.
    upper = np.array(Image.open(OLD / 'native/upper_arm_L.png').convert('RGBA'))
    bottoms = []
    for x in range(upper.shape[1]):
        ys = np.flatnonzero(upper[:, x, 3] > 128)
        bottoms.append(float(ys[-1]) if len(ys) else 64.)
    table = np.zeros((1, len(bottoms), 3), dtype='>u2')
    table[:] = np.rint(np.array(bottoms)[None, :, None] / 128 * 65535)
    path = OUT / 'shoulder-bottoms.ppm'
    path.write_bytes(f'P6\n{len(bottoms)} 1\n65535\n'.encode() + table.tobytes())
    convert(OLD / 'native/upper_arm_L.png', '-background', 'none', '-gravity', 'northwest',
            '-extent', '200x107', OUT / 'upper-padded.png')
    convert(OUT / 'upper-padded.png', path, '-virtual-pixel', 'transparent', '-interpolate', 'bilinear', '-channel', 'RGBA', '-fx',
            'edge=v.p{i,0}.r*128;u.p{i,edge+(j-28-edge)/1.5}', native / 'upper_arm_L.png')
    # Pad the forearm left/right so widening cannot clip its elbow silhouette.
    source = ROOT / 'work/arm-01/r12-wrist/native/forearm_L.png'
    convert(source, '-bordercolor', 'none', '-border', '16x0', OUT / 'forearm-padded.png')
    arm = np.array(Image.open(OUT / 'forearm-padded.png').convert('RGBA'))
    rows = []
    for y in range(arm.shape[0]):
        xs = np.flatnonzero(arm[y, :, 3] > 128)
        left, right = (float(xs[0]), float(xs[-1])) if len(xs) > 1 else (0., 1.)
        t = np.clip((y-60)/65, 0, 1)
        gain = .22*t*t*(3-2*t)
        rows.append([left, right, right-(right-left)*(1+gain), right])
    table = np.rint(np.array(rows)[:, None, :]/256*65535).astype('>u2')
    path = OUT / 'forearm-width-map.pam'
    path.write_bytes(f'P7\nWIDTH 1\nHEIGHT {len(rows)}\nDEPTH 4\nMAXVAL 65535\nTUPLTYPE RGB_ALPHA\nENDHDR\n'.encode()+table.tobytes())
    convert(OUT / 'forearm-padded.png', path, '-virtual-pixel', 'transparent', '-interpolate', 'bilinear', '-channel', 'RGBA', '-fx',
            'sl=v.p{0,j}.r*256;sr=v.p{0,j}.g*256;dl=v.p{0,j}.b*256;dr=v.p{0,j}.a*256;'
            'j<60?u:u.p{sl+(i-dl)*(sr-sl)/(dr-dl),j}', native / 'forearm_L-base.png')
    # Cover the internal forearm contour only where the enlarged shoulder is opaque.
    a = np.array(Image.open(native / 'forearm_L-base.png').convert('RGBA'))[:, :, 3]
    u = np.array(Image.open(native / 'upper_arm_L.png').convert('RGBA'))[:, :, 3]
    mask = np.full(a.shape, 255, dtype=np.uint8)
    for y in range(100, a.shape[0]):
        xs = np.flatnonzero(a[y] > 128)
        if not len(xs):
            continue
        left, right = xs[0], xs[-1]
        for x in range(max(0, left-2), min(a.shape[1], left+9)):
            ux, uy = x+228-110, y+145-242
            if x < (left+right)/2 and 0 <= uy < u.shape[0] and 0 <= ux < u.shape[1] and u[uy, ux] >= 250:
                mask[y, x] = round(255*np.clip((x-left-3)/4, 0, 1))
    path = OUT / 'elbow-overlap.pgm'
    path.write_bytes(f'P5\n{a.shape[1]} {a.shape[0]}\n255\n'.encode()+mask.tobytes())
    convert(native / 'forearm_L-base.png', path, '-channel', 'A', '-fx', 'u*v.r', '+channel', native / 'forearm_L.png')
    for name in ['hand_L', 'bracelet_red_L', 'bracelet_blue_L']:
        shutil.copy2(OLD / 'native' / (name+'.png'), native / (name+'.png'))
    layout = json.loads((OLD / 'layout.json').read_text())
    layout['name'] = 'ARM-01 r14 corrected arm thickness'
    for layer in layout['layers']:
        name = layer['id']
        if name == 'upper_arm_L':
            layer['rect'].update(top=242)
        if name == 'forearm_L':
            layer['rect'].update(left=228)
        w, h = Image.open(native / (name+'.png')).size
        layer['rect'].update(width=w, height=h)
        layer['image'].update(width=w, height=h)
    (OUT / 'layout.json').write_text(json.dumps(layout, indent=2)+'\n')
    cmd = ['-size', '440x380', 'xc:none']
    for layer in layout['layers']:
        rect = layer['rect']
        cmd += [OUT / layer['image']['path'], '-geometry', f"+{rect['left']}+{rect['top']}", '-composite']
    convert(*cmd, OUT / 'prepared.png')
    print('Prepared r14 geometry correction; shoulder 1.5x thickness, forearm up to 1.22x')


if __name__ == '__main__':
    main()
