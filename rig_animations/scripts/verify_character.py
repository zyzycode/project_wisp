"""Save/reopen and exchange-format checks for the authored frontal rig."""
import hashlib
import io
import json
import shutil

import numpy as np
from PIL import Image

from check_moc3 import check as check_moc3
from mcp import ROOT, client
from smoke_test import same_pixels

OUT=ROOT/'work/full-rig-v1'
POSES=[{}, {'ParamEyeBallX':-1,'ParamEyeBallY':.7},
       {'ParamEyeLOpen':0,'ParamEyeROpen':0},
       {'ParamEyeLOpen':.5,'ParamEyeROpen':.5,'ParamMouthOpenY':1},
       {'ParamArmLA':55,'ParamArmLB':85,'ParamMouthOpenY':.65},
       {'ParamStepL':1,'ParamStepR':0}]


def dump(name,data):
    (OUT/name).write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n')


def render(c,name):
    _,images=c.call('view_render_poses',{
        'viewport':{'mode':'canvas_rect','left':0,'top':0,'width':1024,'height':1536},
        'poses':POSES,'columns':3,'target_long_edge':1800})
    for i,png in enumerate(images):(OUT/f'{name}-{i}.png').write_bytes(png)
    return images


def main():
    report={'passed':False,'editor_version':'3.5.1','scope':'frontal authoring rig'}
    try:
        with client() as c:
            before=render(c,'verified-before')
            saved=c.edit('project_save')
            reopened=c.edit('project_open',path=str(OUT/'wisp-frontal.psd2live'))
            after=render(c,'verified-reopened')
            report['reopened_render_identical']=len(before)==len(after) and all(same_pixels(a,b) for a,b in zip(before,after))
            report['revision_preserved']=saved['revision']==reopened['revision']
            assert report['reopened_render_identical'] and report['revision_preserved']
            motions=json.loads((OUT/'authored-motions.json').read_text())
            for motion in motions:
                c.call('motion_get',{'id':motion['id']})
            report['authored_clip_count']=len(motions)
            overview=c.call('workspace_overview',{'limit':200})[0]
            dump('overview-final.json',overview)
            report['parameter_count']=overview['parameters']['total']
            exported=c.edit('project_export_model',output_directory=str(OUT/'export'))
            dump('model-export.json',exported)
            model3=next((OUT/'export').rglob('*.model3.json'))
            refs=json.loads(model3.read_text())['FileReferences']
            for relative in [refs['Moc'],*refs['Textures']]:assert (model3.parent/relative).is_file()
            motion_files=[entry['File'] for entries in refs.get('Motions',{}).values() for entry in entries]
            normalize=lambda value: ''.join(ch for ch in value.lower() if ch.isalnum())
            for clip in motions:
                assert any(normalize(clip['id']) in normalize(path) for path in motion_files),clip['id']
            report['all_authored_clips_exported']=True
            moc=model3.parent/refs['Moc'];report.update(check_moc3(moc))
            report['moc3_sha256']=hashlib.sha256(moc.read_bytes()).hexdigest()
            cmo=next((OUT/'export').rglob('*.cmo3'))
            c.edit('project_import_cmo3',path=str(cmo),mode='new')
            imported=render(c,'verified-cmo3')
            report['cmo3_import_render_identical']=len(before)==len(imported) and all(same_pixels(a,b) for a,b in zip(before,imported))
            differences=[]
            for first,second in zip(before,imported):
                frames=[]
                for png in [first,second]:
                    image=Image.open(io.BytesIO(png)).convert('RGBA')
                    background=Image.new('RGBA',image.size,(240,242,245,255))
                    frames.append(np.array(Image.alpha_composite(background,image).convert('RGB')).astype(int))
                delta=abs(frames[0]-frames[1])
                differences.append({'mean_rgb_error_255':float(delta.mean()),
                    'pixels_over_8':int((delta.max(2)>8).sum()),'pixels_over_32':int((delta.max(2)>32).sum())})
            report['cmo3_render_difference']=differences
            c.edit('project_save_as',path=str(OUT/'cmo3-roundtrip.psd2live'))
            c.edit('project_open',path=str(OUT/'wisp-frontal.psd2live'))
            web=c.edit('project_export_target',target='web',output_directory=str(OUT/'web'))
            dump('web-export.json',web)
            report['web_export_losses']=web.get('losses',[])
            shutil.copyfile(ROOT/'preview.html',OUT/'web/index.html')
            report['exchange_warning']=None if report['cmo3_import_render_identical'] else 'CMO3 roundtrip is not pixel-identical; inspect difference metrics and contact sheets.'
            report['status']='passed' if report['cmo3_import_render_identical'] else 'passed_with_cmo3_roundtrip_difference'
            report['passed']=True
    finally:
        dump('verification.json',report)
        print(json.dumps(report,indent=2),flush=True)


if __name__=='__main__':main()
