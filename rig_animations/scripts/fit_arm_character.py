"""Static sleeve fitting with original cloth pixels and accepted r15 arm layers."""
import json
from pathlib import Path
import shutil
import subprocess

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'work/arm-01/r16-fit'
ARM = ROOT / 'work/arm-01/r15-elbow'
CLOTH = ROOT / 'work/arm-01/r04'
GAZE = ROOT / 'work/gaze-01/r08'
SOURCE_CORNERS = [[649,544], [748,691], [639,754], [617,650]]
TARGET_CORNERS = [[620,510], [775,530], [742,683], [617,650]]
OLD_ARM = '650,680 790,680 850,800 850,980 710,980 710,850 695,805 670,770 650,750'


def convert(*args):
    subprocess.run(['convert', *map(str, args)], check=True)


def cloth_coordinates():
    """Invert a four-corner bilinear surface without a projective horizon."""
    a, b, c, d = np.array(TARGET_CORNERS, dtype=float)
    yy, xx = np.mgrid[:260, :220]
    points = np.stack([xx+600, yy+490], axis=-1)
    s = (xx-20)/155
    t = (yy-20)/170
    for _ in range(16):
        value = a+(b-a)*s[...,None]+(d-a)*t[...,None]+(a-b+c-d)*(s*t)[...,None]
        ds = (b-a)+(a-b+c-d)*t[...,None]
        dt = (d-a)+(a-b+c-d)*s[...,None]
        delta = value-points
        det = ds[...,0]*dt[...,1]-ds[...,1]*dt[...,0]
        s -= (delta[...,0]*dt[...,1]-delta[...,1]*dt[...,0])/det
        t -= (ds[...,0]*delta[...,1]-ds[...,1]*delta[...,0])/det
    a, b, c, d = np.array(SOURCE_CORNERS, dtype=float)
    source = a+(b-a)*s[...,None]+(d-a)*t[...,None]+(a-b+c-d)*(s*t)[...,None]
    source -= [610,535]
    table = np.zeros((260,220,3), dtype='>u2')
    table[:,:,:2] = np.rint(np.clip((source+128)/512, 0, 1)*65535).astype('>u2')
    path = OUT / 'cloth-coordinates.ppm'
    path.write_bytes(b'P6\n220 260\n65535\n'+table.tobytes())
    return path


def main():
    if (OUT / 'arm-01-r16-fit.psd2live').exists():
        raise RuntimeError('Preserve saved revision')
    native = OUT / 'native'
    native.mkdir(parents=True, exist_ok=True)
    mask = OUT / 'old-arm-mask.png'
    convert('-size', '1024x1536', 'xc:black', '-fill', 'white', '-draw', 'polygon '+OLD_ARM, mask)
    old = np.array(Image.open(mask).convert('L')) > 0
    coverage = np.zeros(old.shape, dtype=int)
    coordinates = cloth_coordinates()
    for name in ['sleeve_front_L', 'sleeve_rim_L']:
        source = CLOTH / (name+'.png')
        coverage += np.array(Image.open(source).convert('RGBA'))[:, :, 3].astype(int)
        if name == 'sleeve_rim_L':
            continue
        convert(source, '-crop', '145x235+610+535', '+repage', '-virtual-pixel', 'transparent',
                '-background', 'none', '-gravity', 'northwest', '-extent', '220x260', coordinates,
                '-interpolate', 'bilinear', '-channel', 'RGBA', '-fx',
                'u.p{v.r*512-128,v.g*512-128}', native / (name+'.png'))
        # Clip enlarged source-mask stair steps to the mapped underarm hem.
        # This is an alpha contour, not a repainted cloth edge.
        convert(native / (name+'.png'), '-channel', 'A', '-fx',
                'i+600>=617&&i+600<=743?min(u,max(0,min(1,650+(i+600-617)*33/125-(j+490)+0.5))):u',
                '+channel', native / (name+'.png'))
    # One generated backing restores the cuff surface hidden by the original arm.
    rim_raw = OUT / 'raw/sleeve_inner_rim.png'
    alpha = np.array(Image.open(rim_raw).convert('RGBA'))[:,:,3]
    ys,xs = np.where(alpha>128)
    rx,ry = int(xs.min())-3,int(ys.min())-3
    rw,rh = int(xs.max())-rx+4,int(ys.max())-ry+4
    convert(rim_raw, '-crop', f'{rw}x{rh}+{rx}+{ry}', '+repage', '-resize', 'x155',
            '-background', 'none', '-rotate', '-2', '-trim', '+repage',
            '-bordercolor', 'none', '-border', '2', native / 'sleeve_rim_L.png')
    base = GAZE / 'source/character_original.png'
    source_alpha = np.array(Image.open(base).convert('RGBA'))[:,:,3].astype(float)
    keep = np.divide(np.maximum(0,source_alpha-coverage),source_alpha,
                     out=np.zeros_like(source_alpha),where=source_alpha>0)
    keep[old] = 0
    old |= coverage>0
    keep = np.rint(keep*65535).astype('>u2')
    path = OUT / 'base-keep-mask.pgm'
    path.write_bytes(b'P5\n1024 1536\n65535\n'+keep.tobytes())
    convert(base, path, '-channel', 'A', '-fx', 'u*v.r', '+channel', native / 'character_original.png')
    layers = []
    for layer in json.loads((ARM / 'layout.json').read_text())['layers']:
        name = layer['id']
        shutil.copy2(ARM / layer['image']['path'], native / (name+'.png'))
        layer['rect']['left'] += 505
        layer['rect']['top'] += 265
        layers.append(layer)
    cloth = [{'id': name, 'image': {'path': 'native/'+name+'.png', 'width': 220, 'height': 260},
              'rect': {'left': 600, 'top': 490, 'width': 220, 'height': 260}}
             for name in ['sleeve_rim_L', 'sleeve_front_L']]
    rw_native,rh_native = Image.open(native / 'sleeve_rim_L.png').size
    cloth[0]['image'].update(width=rw_native,height=rh_native)
    cloth[0]['rect'].update(left=735,top=528,width=rw_native,height=rh_native)
    ordered = [cloth[0], *layers, cloth[1]]
    (OUT / 'placement.json').write_text(json.dumps(ordered, indent=2)+'\n')
    # Composite against the accepted gaze neutral render for an early visual check.
    convert(GAZE / 'poses/neutral-full.png', path, '-channel', 'A', '-fx', 'u*v.r', '+channel', OUT / 'neutral-base.png')
    cmd = [OUT / 'neutral-base.png']
    for layer in ordered:
        r = layer['rect']
        cmd += [OUT / layer['image']['path'], '-geometry', f"+{r['left']}+{r['top']}", '-composite']
    convert(*cmd, OUT / 'prepared.png')
    before = np.array(Image.open(base).convert('RGBA'))
    after = np.array(Image.open(native / 'character_original.png').convert('RGBA'))
    stable = (~old) & (before[:, :, 3] > 0)
    assert np.array_equal(before[stable], after[stable])
    for layer in layers:
        name = layer['id']+'.png'
        assert (native / name).read_bytes() == (ARM / 'native' / name).read_bytes()
    record = {'method': 'Original sleeve pixels with four-corner bilinear cloth deformation; alpha-only old arm removal',
              'sleeve_source': str(CLOTH.relative_to(ROOT)), 'sleeve_source_corners': SOURCE_CORNERS,
              'sleeve_target_corners': TARGET_CORNERS,
              'sleeve_hem_alpha_clip': 'mapped D-C segment, 1 px coverage ramp; no RGB paint',
              'sleeve_source_crop': [610,535,145,235], 'sleeve_output_crop': [600,490,220,260],
              'old_arm_polygon': OLD_ARM, 'arm_translation': [505, 265], 'arm_scale': 1,
              'arm_layers_byte_identical': True, 'base_visible_pixels_outside_mask_identical': True,
              'new_generation': {'layer':'sleeve_rim_L','tool':'built-in image_gen','execution':'cloud',
                                 'one_image_per_request':True,'cost':'not returned by service',
                                 'references':['character_reference.png','work/arm-01/r08-target/raw/target-v1.png'],
                                 'crop':[rx,ry,rw,rh],'uniform_resize_height':155,'rotation_degrees':-2,'border':2},
              'neutral_note': 'Static raised fit; lowering and straightening require later controller review'}
    (OUT / 'preparation.json').write_text(json.dumps(record, indent=2)+'\n')
    print('Prepared original-cloth fitting; accepted arm textures unchanged')


if __name__ == '__main__':
    main()
