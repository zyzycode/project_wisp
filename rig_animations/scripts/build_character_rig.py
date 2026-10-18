"""Import the prepared frontal character and create a real PSD2Live authoring rig."""
import json
from datetime import datetime, timezone
import shutil
from mcp import ROOT, client

OUT=ROOT/'work/full-rig-v1'


def save_json(name,data):
    (OUT/name).write_text(json.dumps(data,indent=2)+'\n')


def main():
    with client() as c:
        # Keep any existing workspace changes before opening the prepared source.
        if c.project()['loaded']: c.edit('project_save')
        project=OUT/'wisp-frontal.psd2live'
        if project.exists():
            backups=OUT/'backups';backups.mkdir(exist_ok=True)
            stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
            shutil.copy2(project,backups/(stamp+'.psd2live'))
        c.edit('project_import_layout',path=str(OUT/'source/layout.json'))
        c.edit('settings_update',changes={
            'meshOnly':False,'generateDeformers':True,'generatePhysics':False,
            'featureDisplacementEnabled':False,'mouthOutlineEnabled':False,
            'motionBasic':False,'motionSkeleton':False,'exportMotions':True,
            'exportMoc3':True,'exportCmo3':True,'headStrength':0.4,'bodyStrength':0.5,
            'rigTuning':{'faceTurn':4,'faceTilt':3,'faceContour':0,'faceArch':1,
                'gazeX':16,'gazeY':10,'irisJellyStretch':0,'irisJellySquash':0,
                'breathLift':1.2,'breathWiden':0.7,'browLift':18,'mouthSmile':10}})
        print('Generating 22 source layers...',flush=True)
        generated=c.edit('rig_generate');save_json('generated.json',generated)
        overview=c.call('workspace_overview',{'limit':200})[0];save_json('overview.json',overview)
        objects=[];offset=0
        while True:
            page=c.call('workspace_inspect',{'scope':'objects','offset':offset,'limit':64})[0]
            objects+=page['items']
            if 'next' not in page: break
            offset=page['next']
        save_json('objects.json',objects)
        proposal=c.call('skeleton_propose')[0];save_json('skeleton-proposal.json',proposal)
        c.edit('project_save_as',path=str(OUT/'wisp-frontal.psd2live'))
        poses=[{}, {'ParamEyeBallX':-1},{'ParamEyeBallX':1},
            {'ParamEyeLOpen':0,'ParamEyeROpen':0},{'ParamEyeLOpen':0.5,'ParamEyeROpen':0.5},
            {'ParamMouthOpenY':1,'ParamMouthForm':1}]
        data,images=c.call('view_render_poses',{'viewport':{'mode':'canvas_rect','left':350,'top':235,'width':330,'height':245},
            'poses':poses,'columns':3,'target_long_edge':1600})
        for i,png in enumerate(images): (OUT/f'face-initial-{i}.png').write_bytes(png)
        save_json('face-initial.json',data)
        print('Saved:',OUT/'wisp-frontal.psd2live',flush=True)
        print('Objects:',len(objects),'skeleton proposal fields:',list(proposal))


if __name__=='__main__':main()
