"""Author repeatable motion clips on the real frontal mesh rig."""
import json
import math
import shutil

from mcp import ROOT, client

OUT=ROOT/'work/full-rig-v1'


def curve(parameter,points):
    return {'parameter':parameter,'keys':[{'time':round(t,5),'value':round(v,5)} for t,v in points]}


def oscillate(duration,period,amplitude=1,offset=0):
    return [(i/20,offset+amplitude*math.sin(2*math.pi*i/20/period))
            for i in range(round(duration*20)+1)]


def clips():
    blink=[(0,1),(1.4,1),(1.49,0),(1.57,0),(1.7,1),(4,1)]
    idle={'ParamBreath':oscillate(4,4,.35,.35),
          'ParamEyeLOpen':blink,'ParamEyeROpen':blink,
          'ParamHairFront':oscillate(4,4,.5),'ParamHairBack':oscillate(4,4,-.3)}
    look={'ParamEyeBallX':[(0,0),(.6,-.9),(1.3,-.9),(2.1,.9),(2.9,.9),(3.6,0),(4,0)],
          'ParamEyeBallY':[(0,0),(1,0),(2,.4),(3,.4),(4,0)]}
    wink={'ParamEyeLOpen':[(0,1),(.3,1),(.45,0),(.8,0),(1,1),(2,1)],
          'ParamMouthForm':[(0,0),(.3,1),(1,1),(2,0)],
          'ParamMouthOpenY':[(0,0),(.3,.65),(1,.65),(2,0)]}
    talk={'ParamMouthOpenY':[(i/8, max(0,math.sin(i*2.2))*.9) for i in range(25)],
          'ParamMouthForm':[(0,.3),(3,.3)]}
    talk['ParamMouthOpenY'][-1]=(3,0)
    curious={'ParamAngleZ':[(0,0),(.8,3),(2.1,3),(3,0)],
             'ParamBrowLY':[(0,0),(.8,.65),(2.1,.65),(3,0)],
             'ParamEyeBallX':[(0,0),(.8,.6),(2.1,.6),(3,0)]}
    wave={'ParamArmLA':[(0,0),(.7,55),(2.2,55),(3,0)],
          'ParamArmLB':[(0,0),(.7,85),(1,102),(1.3,75),(1.6,102),(1.9,75),(2.2,85),(3,0)],
          'ParamHandL':[(0,0),(.7,0),(1,12),(1.3,-10),(1.6,12),(1.9,-10),(2.2,0),(3,0)],
          'ParamMouthOpenY':[(0,0),(.7,.65),(2.2,.65),(3,0)]}
    step={}
    for letter,phase in [('L',0),('R',math.pi)]:
        step['ParamStep'+letter]=[(i/20,max(0,math.sin(2*math.pi*i/20+phase))) for i in range(81)]
        step['ParamArm'+letter+'A']=oscillate(4,1,5 if letter=='L' else -5)
    happy={'ParamEyeLOpen':[(0,1),(.5,.55),(1.6,.55),(2.4,1)],
           'ParamEyeROpen':[(0,1),(.5,.55),(1.6,.55),(2.4,1)],
           'ParamMouthOpenY':[(0,0),(.5,1),(1.6,1),(2.4,0)],
           'ParamMouthForm':[(0,0),(.5,1),(1.6,1),(2.4,0)],
           'ParamBrowLY':[(0,0),(.5,.35),(1.6,.35),(2.4,0)],
           'ParamBrowRY':[(0,0),(.5,.35),(1.6,.35),(2.4,0)]}
    result=[('idle',4,True,idle),('look_around',4,True,look),('wink',2,False,wink),
            ('talking',3,True,talk),('curious',3,False,curious),('wave',3,False,wave),
            ('step_front',4,True,step),('happy',2.4,False,happy)]
    showcase={}
    for start,duration,group in [(0,4,look),(3,2,wink),(5,3,wave),(8,4,step)]:
        for name,points in group.items():
            base=1 if name in ['ParamEyeLOpen','ParamEyeROpen'] else 0
            target=showcase.setdefault(name,[(0,base)])
            target.extend((start+t,v) for t,v in points)
            target.append((start+duration,base))
    showcase['ParamBreath']=oscillate(12,4,.35,.35)
    showcase['ParamHairFront']=oscillate(12,4,.5)
    # Sort and coalesce shared clip boundaries, then return to the neutral pose.
    for name,points in showcase.items():
        base=1 if name in ['ParamEyeLOpen','ParamEyeROpen'] else 0
        points.append((12,dict(points).get(0,base)));showcase[name]=sorted(dict(points).items())
    result.append(('showcase',12,True,showcase))
    return result


def main():
    with client() as c:
        overview=c.call('workspace_overview',{'limit':200})[0]
        params={p['id']:p for p in overview['parameters']['items']}
        objects=json.loads((OUT/'objects.json').read_text())
        meshes={o['layerId']:o['target'] for o in objects if o['target'].startswith('mesh:')}
        for side,letter in [('left','L'),('right','R')]:
            param='ParamStep'+letter
            if param in params:continue
            boot='boot_'+side
            # The raised boot overlaps the leg, preserving its hip attachment.
            # Do not add a second shortening deformation to the baked knee rig.
            c.edit('author_axis',parameter={'id':param,'name':'Front step '+letter,'min':0,'max':1,'default':0},
                shapes=[{'target':meshes[boot],'value':1,'operations':[
                    {'type':'translate','delta':[0,.037]}]}])
        params=c.call('workspace_overview',{'limit':200})[0]['parameters']['items']
        manifest=[]
        for name,duration,loop,curves in clips():
            # Every clip sets all parameters, so switching clips cannot retain a pose.
            for p in params:curves.setdefault(p['id'],[(0,p['default']),(duration,p['default'])])
            clip={'id':'wisp_'+name,'name':'wisp_'+name,'duration':duration,'fps':30,'loop':loop,
                  'enabled':True,'fade_in':.2,'fade_out':.2,
                  'curves':[curve(p,points) for p,points in curves.items()]}
            c.edit('motion_put',clip=clip)
            manifest.append(clip)
        (OUT/'authored-motions.json').write_text(json.dumps(manifest,indent=2)+'\n')
        c.edit('project_save')
        print('Saved 9 clips including 12-second showcase',flush=True)
        exported=c.edit('project_export_target',target='gif',output_directory=str(OUT/'preview'),
            settings={'clip':'wisp_showcase','fps':'20','size':'768','physics':'false','background':'FFF0F2F5'})
        (OUT/'preview-export.json').write_text(json.dumps(exported,indent=2)+'\n')
        print(json.dumps(exported),flush=True)
        ffmpeg=shutil.which('ffmpeg')
        if ffmpeg:
            video=c.edit('project_export_target',target='mp4',output_directory=str(OUT/'preview'),
                settings={'clip':'wisp_showcase','fps':'30','size':'768','physics':'false',
                          'background':'FFF0F2F5','ffmpeg':ffmpeg})
            (OUT/'video-export.json').write_text(json.dumps(video,indent=2)+'\n')


if __name__=='__main__':main()
