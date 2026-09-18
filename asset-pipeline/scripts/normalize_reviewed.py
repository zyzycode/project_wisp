"""Reproduce reviewed scale/anchor repairs without cumulative PNG resampling.

Reads immutable source frames from the recorded Git revision or source sheets.
Default: prepare previews/proposal only. --apply installs the reviewed batch.
"""
import argparse
from copy import deepcopy
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import re
import subprocess

from PIL import Image, ImageDraw

from lib.output_paths import prepare_output_file, prepare_sprite_file
from lib.reviewed_extraction import extract_reviewed

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT.parent
RECIPE = ROOT / 'references/normalization-2026-09.json'
MANIFEST = PROJECT / 'public/assets/sprites/manifest.json'
OUTPUT = ROOT / 'output/normalization'


def url(frame):
    return frame if isinstance(frame, str) else frame['source']


def from_revision(revision, path):
    return subprocess.run(['git', 'show', f'{revision}:{path}'], cwd=PROJECT,
                          check=True, capture_output=True).stdout


def place(image, scale, origin, destination):
    """Uniform resampling with unchanged alpha and no clipped opaque pixels."""
    if scale == 1 and origin == destination and image.size == (512, 512):
        return image.copy(), lambda value: {'x': value[0], 'y': value[1]}
    width, height = round(image.width*scale), round(image.height*scale)
    offset = (round(destination[0]-origin[0]*scale),
              round(destination[1]-origin[1]*scale))
    resized = image.resize((width, height), Image.Resampling.LANCZOS)
    bounds = resized.getbbox()
    projected = (bounds[0]+offset[0], bounds[1]+offset[1],
                 bounds[2]+offset[0], bounds[3]+offset[1])
    if min(projected[:2]) < 4 or max(projected[2:]) > 508:
        raise ValueError(f'Clipping or insufficient margin: {projected}')
    canvas = Image.new('RGBA', (512, 512))
    canvas.alpha_composite(resized, offset)

    def point(value):
        return {'x': round(value[0]*scale+offset[0]),
                'y': round(value[1]*scale+offset[1])}
    return canvas, point


def replace_entries(text, entries):
    # Keep all unrelated entries byte-for-byte, including their formatting.
    decoder = json.JSONDecoder()
    replacements = []
    for key, value in entries.items():
        match = re.search(r'^  '+re.escape(json.dumps(key))+r':\s*', text, re.M)
        if match is None:
            raise ValueError(f'Missing manifest entry: {key}')
        _, length = decoder.raw_decode(text[match.end():])
        replacement = json.dumps(value, ensure_ascii=False, indent=2).replace('\n', '\n  ')
        replacements.append((match.end(), match.end()+length, replacement))
    for start, end, replacement in sorted(replacements, reverse=True):
        text = text[:start]+replacement+text[end:]
    return text


def compose(body, definition, index, face, face_definition):
    result = body.copy()
    if definition['faceOverlay']['mode'] == 'overlay':
        meta = definition.get('frameMeta', [{}]*len(definition['frames']))[index]
        anchor = meta.get('anchors', definition.get('defaultAnchors', {}))['face']
        pivot = face_definition.get('pivot', {'x': 256, 'y': 180})
        result.alpha_composite(face, (round(anchor['x']-pivot['x']),
                                      round(anchor['y']-pivot['y'])))
    return result


def bake_face(canvas, face, anchor, scale_x=1, scale_y=1):
    """Attach existing expression pixels once, in the body's frame coordinates."""
    resized = face.resize((round(face.width*scale_x), round(face.height*scale_y)),
                          Image.Resampling.LANCZOS)
    result = canvas.copy()
    result.alpha_composite(resized, (round(anchor['x']-256*scale_x),
                                     round(anchor['y']-180*scale_y)))
    # Baking must not introduce detached face pixels or alter body edge alpha.
    result.putalpha(canvas.getchannel('A'))
    return result


def prepare():
    recipe = json.loads(RECIPE.read_text(encoding='utf-8'))
    current = json.loads(MANIFEST.read_text(encoding='utf-8'))
    baseline = json.loads(from_revision(recipe['sourceRevision'],
                                        'public/assets/sprites/manifest.json'))
    images, originals, entries, measurements, unbaked = {}, {}, {}, {}, {}
    for key, spec in recipe['animations'].items():
        definition = deepcopy(current[key])
        if 'faceOverlay' in spec:
            definition['faceOverlay'] = spec['faceOverlay']
        if 'sourceFile' in spec:
            definition['sourceFile'] = spec['sourceFile']
        original = baseline[key]
        if list(map(url, definition['frames'])) != list(map(url, original['frames'])):
            raise ValueError(f'Frame list changed since review: {key}')
        sources = None
        if 'sheet' in spec:
            if 'sheetSha256' in spec:
                source_path = (PROJECT / spec['sheet']).resolve()
                if (ROOT / 'generated_images').resolve() not in source_path.parents:
                    raise ValueError('Reviewed source pack must be inside generated_images')
                data = source_path.read_bytes()
                if sha256(data).hexdigest() != spec['sheetSha256']:
                    raise ValueError(f'Source pack changed since review: {source_path}')
            else:
                data = from_revision(recipe['sourceRevision'], spec['sheet'])
            source = Image.open(BytesIO(data))
            sources = extract_reviewed(source, len(original['frames']))
        images[key], originals[key], measurements[key] = [], [], []
        unbaked[key] = []
        metadata = deepcopy(definition.get('frameMeta', [{} for _ in spec['frames']]))
        for index, frame_spec in enumerate(spec['frames']):
            path = 'public'+url(original['frames'][index])
            old = Image.open(BytesIO(from_revision(recipe['sourceRevision'], path))).convert('RGBA')
            originals[key].append(old)
            source = old if sources is None else sources[frame_spec.get('sourceIndex', index)]
            scale = frame_spec.get('scale', 1)
            if 'headHeight' in frame_spec:
                scale = recipe['targetHeadHeight']/frame_spec['headHeight']
            origin = frame_spec.get('origin', [256, 460] if sources is None
                                    else [source.width/2, source.height])
            destination = frame_spec.get('destination', [256, 460])
            canvas, point = place(source, scale, origin, destination)
            unbaked[key].append(canvas)
            if 'bakedFace' in frame_spec:
                face_spec = frame_spec['bakedFace']
                face_path = 'public'+url(baseline[face_spec['key']]['frames'][face_spec['frame']])
                face = Image.open(BytesIO(from_revision(recipe['sourceRevision'], face_path))).convert('RGBA')
                canvas = bake_face(canvas, face, point(frame_spec['face']),
                                   face_spec.get('scaleX', 1), face_spec.get('scaleY', 1))
            images[key].append(canvas)
            bounds = canvas.getbbox()
            if 'pivot' in frame_spec:
                frame = definition['frames'][index]
                if not isinstance(frame, dict):
                    raise ValueError(f'Explicit frame geometry requires a frame object: {key}')
                frame['pivot'] = point(frame_spec['pivot'])
                frame['anchors'] = {name: point(value) for name, value in frame_spec['anchors'].items()}
                frame['bounds'] = {'x': bounds[0], 'y': bounds[1],
                                   'width': bounds[2]-bounds[0], 'height': bounds[3]-bounds[1]}
            # SpriteFrameMeta owns anchors only. Measured bounds stay in the
            # audit JSON; do not invent ignored runtime metadata fields.
            metadata[index].pop('bounds', None)
            if definition['faceOverlay']['mode'] != 'overlay':
                metadata[index].get('anchors', {}).pop('face', None)
                if not metadata[index].get('anchors'):
                    metadata[index].pop('anchors', None)
                if isinstance(definition['frames'][index], dict):
                    definition['frames'][index].get('anchors', {}).pop('face', None)
            elif 'face' in frame_spec and 'bakedFace' not in frame_spec:
                metadata[index].setdefault('anchors', {})['face'] = point(frame_spec['face'])
            elif 'bakedFace' in frame_spec:
                metadata[index].get('anchors', {}).pop('face', None)
                if not metadata[index].get('anchors'):
                    metadata[index].pop('anchors', None)
            measurements[key].append({'scale': scale, 'bounds': bounds,
                                      'face': metadata[index].get('anchors', {}).get('face')})
        if any(metadata):
            definition['frameMeta'] = metadata
        else:
            definition.pop('frameMeta', None)
        definition['canvasSize'] = {'width': 512, 'height': 512}
        if definition['faceOverlay']['mode'] == 'overlay':
            definition.setdefault('defaultAnchors', {})['face'] = metadata[0]['anchors']['face']
        elif 'faceOverlay' in spec:
            definition.get('defaultAnchors', {}).pop('face', None)
            if not definition.get('defaultAnchors'):
                definition.pop('defaultAnchors', None)
        entries[key] = definition
    for key, definition in current.items():
        if key.startswith('face_'):
            entries[key] = {**definition, 'pivot': {'x': 256, 'y': 180},
                            'canvasSize': {'width': 512, 'height': 512}}
    return recipe, current, baseline, entries, images, originals, measurements, unbaked


def previews(current, baseline, entries, images, originals):
    face = Image.open(PROJECT / ('public'+url(current['face_happy']['frames'][0]))).convert('RGBA')
    for key, frames in images.items():
        for label, background in [('light', '#e4e4e4'), ('dark', '#242832')]:
            sheet = Image.new('RGBA', (len(frames)*256, 552), background)
            draw = ImageDraw.Draw(sheet)
            for i, frame in enumerate(frames):
                for row, image, entry in [(0, originals[key][i], baseline[key]),
                                           (1, frame, entries[key])]:
                    composite = compose(image, entry, i, face, current['face_happy'])
                    composite.thumbnail((256, 256))
                    sheet.alpha_composite(composite, (i*256, row*276+20))
                    draw.text((i*256+5, row*276+4),
                              f'{key} {i} '+('BEFORE' if row == 0 else 'AFTER'),
                              fill='black' if label == 'light' else 'white')
            sheet.convert('RGB').save(prepare_output_file(str(OUTPUT / f'{key}-{label}.jpg')))
        animated = []
        for index, frame in enumerate(frames):
            canvas = Image.new('RGBA', (512, 512), '#e4e4e4')
            canvas.alpha_composite(compose(frame, entries[key], index, face, current['face_happy']))
            animated.append(canvas.convert('RGB'))
        animated[0].save(prepare_output_file(str(OUTPUT / f'{key}.gif')), save_all=True,
                         append_images=animated[1:], duration=200, loop=0)


def run(apply=False, check=False):
    recipe, current, baseline, entries, images, originals, measurements, unbaked = prepare()
    changed = []
    for key, frames in images.items():
        for index, frame in enumerate(frames):
            path = PROJECT / ('public'+url(current[key]['frames'][index]))
            live = Image.open(path).convert('RGBA')
            if live.tobytes() != frame.tobytes():
                reviewed_previous = recipe['animations'][key].get('previousPngSha256', [])
                is_reviewed_previous = (index < len(reviewed_previous)
                                        and sha256(path.read_bytes()).hexdigest() == reviewed_previous[index])
                if not is_reviewed_previous and live.tobytes() not in (originals[key][index].tobytes(), unbaked[key][index].tobytes()):
                    raise ValueError(f'Unreviewed PNG changes; refusing overwrite: {path}')
                changed.append((path, frame))
    text = MANIFEST.read_text(encoding='utf-8')
    updated = replace_entries(text, entries)
    if check:
        if changed or json.loads(text) != json.loads(updated):
            raise ValueError(f'Reviewed geometry not installed: {len(changed)} PNG(s), or metadata differs')
        print('Reviewed pixels, anchors and all registered face pivots match the recipe')
        return
    previews(current, baseline, entries, images, originals)
    proposal = {'kind': 'wisp-asset-proposal', 'exportTarget': 'public/assets/sprites', 'entries': entries}
    for name, value in [('proposal.json', proposal), ('measurements.json', measurements)]:
        prepare_output_file(str(OUTPUT / name)).write_text(json.dumps(value, indent=2)+'\n', encoding='utf-8')
    if apply:
        # The complete batch and live-file guards have passed before the first write.
        for path, frame in changed:
            frame.save(prepare_sprite_file(str(path)))
        MANIFEST.write_text(updated, encoding='utf-8')
    print(f'{"Installed" if apply else "Prepared"}: {len(changed)} PNG repairs, {len(entries)} metadata entries')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--apply', action='store_true')
    mode.add_argument('--check', action='store_true')
    args = parser.parse_args()
    run(args.apply, args.check)
