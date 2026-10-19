"""Fit static arm layers into a copy of the accepted eye project using native MCP."""
from datetime import datetime, timezone
import hashlib
import io
import json

import numpy as np
from PIL import Image

from mcp import ROOT, client

OUT = ROOT / 'work/arm-01/r16-fit'
BASE = ROOT / 'work/gaze-01/r08/gaze-01-r08.psd2live'
PROJECT = OUT / 'arm-01-r16-fit.psd2live'
POSES = {'neutral': (0,0), 'up': (0,-1), 'down': (0,1), 'left': (-1,0), 'right': (1,0)}


def write(name, value):
    (OUT / name).write_text(json.dumps(value, indent=2)+'\n')


def render(c, name, ids, rect, edge, xy=(0,0)):
    _, images = c.call('view_render_model', {
        'viewport': dict(zip(['left','top','width','height'],rect), mode='canvas_rect'),
        'include_layer_ids': ids, 'background': 'transparent', 'target_long_edge': edge,
        'parameters': dict(zip(['ParamGazeX','ParamGazeY'],xy))})
    assert images
    (OUT / (name+'.png')).write_bytes(images[0])
    return np.array(Image.open(io.BytesIO(images[0])).convert('RGBA'))


def main():
    if PROJECT.exists():
        raise RuntimeError('Preserve saved revision')
    layout = json.loads((OUT / 'placement.json').read_text())
    with client() as c:
        for op in ['project_open','project_save_as','layer_import_images','layer_replace_image',
                   'layer_transform','layer_draw_order','workspace_inspect','view_render_model']:
            write(op+'.schema.json', c.call('workspace_get_operation',{'id':op})[0])
        state = c.project()
        assert not state['busy']
        if state['loaded']:
            stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
            c.edit('project_save_as', path=str(OUT / ('workspace-backup-'+stamp+'.psd2live')))
        c.edit('project_open', path=str(BASE))
        c.edit('project_save_as', path=str(OUT / 'gaze-baseline.psd2live'))
        old_layers = c.call('workspace_inspect',{'scope':'layers','limit':64})[0]['items']
        old_ids = [item['id'] for item in old_layers]
        parameters = c.call('workspace_inspect',{'scope':'parameters','limit':64})[0]['items']
        write('parameters-before.json', parameters)
        old_face = {name: render(c,'gaze-baseline-'+name,old_ids,(350,260,330,210),990,xy)
                    for name,xy in POSES.items()}
        c.edit('layer_replace_image',layer_id='character_original',path=str(OUT / 'native/character_original.png'),
               fit='stretch',rebuild_mesh=False)
        result = c.edit('layer_import_images', paths=[str(OUT / layer['image']['path']) for layer in layout])
        write('import-result.json',result)
        current = c.call('workspace_inspect',{'scope':'layers','limit':64})[0]['items']
        write('imported-layers.json',current)
        added = {item['name']:item for item in current if item['id'] not in old_ids}
        assert len(added) == len(layout), list(added)
        for i, layer in enumerate(layout):
            item = added[layer['id']]
            alpha = Image.open(OUT / layer['image']['path']).convert('RGBA').getchannel('A')
            bbox = alpha.getbbox()
            # Native import trims nonzero alpha and centers that raster. Visible
            # mesh bounds exclude faint edge pixels and are not its registration.
            # Confirmed against the editor-saved source record in import-staged.
            x = (1024-(bbox[2]-bbox[0]))//2
            y = (1536-(bbox[3]-bbox[1]))//2
            rect = layer['rect']
            c.edit('layer_transform',layer_id=item['id'],translate=[rect['left']+bbox[0]-x,rect['top']+bbox[1]-y])
            c.edit('layer_draw_order',target='layer:'+item['id'],order=100+i*10)
        ids = old_ids+[added[layer['id']]['id'] for layer in layout]
        write('render-layer-ids.json',ids)
        now_parameters = c.call('workspace_inspect',{'scope':'parameters','limit':64})[0]['items']
        write('parameters-after.json',now_parameters)
        assert parameters == now_parameters, 'Eye parameter definitions changed'
        c.edit('project_save_as',path=str(PROJECT))
        views = [('full',(0,0,1024,1536),1536),('shoulder',(575,480,265,270),795),
                 ('arm',(600,285,305,445),890)]
        before = {}
        for phase in ['before','after']:
            if phase == 'after':
                c.edit('project_open',path=str(PROJECT))
            assert c.project()['layers'] == 14
            for name,rect,edge in views:
                pixels = render(c,name+'-'+phase,ids,rect,edge)
                if phase == 'before': before[name] = pixels
                else: assert np.array_equal(before[name],pixels), name
        face_errors = {}
        for name,xy in POSES.items():
            now = render(c,'gaze-after-'+name,ids,(350,260,330,210),990,xy)
            a,b = old_face[name].astype(float),now.astype(float)
            delta = np.abs(a[:,:,:3]*a[:,:,3:]/255-b[:,:,:3]*b[:,:,3:]/255)
            face_errors[name] = {'mean_premultiplied_error':float(delta.mean()),'max':float(delta.max())}
            assert delta.mean() < .1, (name,face_errors[name])
    for accepted in ['gaze-01-r08-acceptance.json','arm-01-r12-acceptance.json','arm-01-r15-acceptance.json']:
        for path,sha in json.loads((ROOT / 'reviews' / accepted).read_text())['sha256'].items():
            assert hashlib.sha256((ROOT / path).read_bytes()).hexdigest() == sha,path
    result = {'layers':14,'saved_reopened_three_renders_equal':True,'gaze_parameters_unchanged':True,
              'gaze_five_poses_comparison':face_errors,'accepted_files_hashes_unchanged':True,
              'scope':'Raised static sleeve fitting with accepted eye controls preserved; arm controller not authored'}
    write('verification.json',result)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
