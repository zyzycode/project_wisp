"""Export reviewed sprite recipes with explicit scale landmarks and contact pivots."""
import argparse
from copy import deepcopy
import json
from pathlib import Path

from PIL import Image

from lib.config import PIPELINE_DIR, SPRITES_DIR
from lib.output_paths import prepare_output_file, prepare_sprite_file
from lib.reviewed_extraction import extract_reviewed


def place_frame(image, crown, chin, origin, destination, head_height=140):
    """One uniform scale; contacts transform with pixels, never inferred from bounds."""
    if chin[1] <= crown[1]:
        raise ValueError('Head landmarks must run crown to chin')
    scale = head_height / (chin[1] - crown[1])
    size = (round(image.width * scale), round(image.height * scale))
    offset = (round(destination[0] - origin[0] * scale),
              round(destination[1] - origin[1] * scale))
    bounds = image.getbbox()
    projected = (offset[0]+bounds[0]*scale, offset[1]+bounds[1]*scale,
                 offset[0]+bounds[2]*scale, offset[1]+bounds[3]*scale)
    if min(projected[:2]) < 4 or max(projected[2:]) > 508:
        raise ValueError(f'Clipping or insufficient margin: {projected}')
    canvas = Image.new('RGBA', (512, 512))
    canvas.alpha_composite(image.resize(size, Image.Resampling.LANCZOS), offset)
    def transform(point):
        return {'x': round(offset[0]+point[0]*scale, 2),
                'y': round(offset[1]+point[1]*scale, 2)}
    return canvas, transform, scale


def export(recipe_path):
    root = Path(PIPELINE_DIR)
    recipe = json.loads(Path(recipe_path).read_text(encoding='utf-8'))
    sources = {}
    prepared = {}
    entries = {}
    measurements = {}
    for key, spec in recipe['animations'].items():
        frames, definitions, audit = [], [], []
        for index, frame_spec in enumerate(spec['frames']):
            if 'reuse' in frame_spec:
                source_key, source_index = frame_spec['reuse']
                canvas, definition, measure = prepared[source_key][source_index]
                canvas, definition, measure = canvas.copy(), deepcopy(definition), deepcopy(measure)
            else:
                source = root / frame_spec.get('source', spec['source'])
                if source not in sources:
                    with Image.open(source) as image:
                        if image.mode != 'RGBA' or image.getchannel('A').getextrema()[0] != 0:
                            raise ValueError(f'Requires true alpha: {source}')
                        sources[source] = extract_reviewed(image, 4)
                sprite = sources[source][frame_spec['index']]
                canvas, transform, scale = place_frame(
                    sprite, frame_spec['crown'], frame_spec['chin'],
                    frame_spec['origin'], frame_spec['destination'], recipe['headHeight'])
                anchors = {name: transform(point) for name, point in frame_spec['anchors'].items()}
                definition = {'pivot': transform(frame_spec['pivot']), 'anchors': anchors}
                measure = {'source': str(source.relative_to(root)), 'sourceFrame': frame_spec['index'],
                           'scale': scale, 'crown': transform(frame_spec['crown']),
                           'chin': transform(frame_spec['chin'])}
            path = Path(SPRITES_DIR) / 'body' / key.removeprefix('body_') / f'{key}_{index:02d}.png'
            definition['source'] = '/assets/sprites/' + path.relative_to(SPRITES_DIR).as_posix()
            definition['durationMs'] = spec.get('durationMs', 200)
            bbox = canvas.getbbox()
            definition['bounds'] = {'x': bbox[0], 'y': bbox[1], 'width': bbox[2]-bbox[0], 'height': bbox[3]-bbox[1]}
            measure['bbox'] = list(bbox)
            frames.append((canvas, definition, measure))
            definitions.append(definition)
            audit.append(measure)
        prepared[key] = frames
        entries[key] = {'category': 'body/'+key.removeprefix('body_'), 'frames': definitions,
                        'framesCount': len(frames), 'canvasSize': {'width': 512, 'height': 512},
                        'fps': 1000/spec.get('durationMs', 200),
                        'faceOverlay': {'mode': 'baked_in', 'fallback': 'none'}}
        measurements[key] = audit
    # Validate the entire batch before replacing any exported PNG.
    for key, frames in prepared.items():
        for index, (canvas, _, _) in enumerate(frames):
            path = Path(SPRITES_DIR) / 'body' / key.removeprefix('body_') / f'{key}_{index:02d}.png'
            canvas.save(prepare_sprite_file(str(path), sources=list(sources)))
    proposal = {'kind': 'wisp-asset-proposal', 'exportTarget': 'public/assets/sprites',
                'note': 'Reviewed pixel landmarks; registration remains a separate application change.',
                'entries': entries}
    for name, value in [('manifest-proposal.json', proposal), ('refinement/measurements.json', measurements)]:
        path = prepare_output_file(str(root / 'output' / name))
        path.write_text(json.dumps(value, indent=2), encoding='utf-8')
    print(f'Exported {sum(len(v) for v in prepared.values())} frames for {len(prepared)} animations')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--recipe', required=True)
    export(parser.parse_args().recipe)
