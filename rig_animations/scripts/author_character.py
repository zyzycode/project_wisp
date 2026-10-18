"""Explicit eye clipping, face controls and corrected chibi skeleton."""
import json
from mcp import ROOT,client

OUT=ROOT/'work/full-rig-v1'


def batch(c,edits,summary):
    return c.edit('workspace_apply_edits',edits=edits,summary=summary)


def channels(target,param,values):
    return {'operation':'keyform_apply','request':{'changes':[
        {'op':'set','target':target,'key':{param:key},'channels':{'opacity':value}}
        for key,value in values]}}


def seed(target,param,values):
    return {'operation':'keyform_apply','request':{'changes':[
        {'op':'seed','target':target,'key':{param:value}} for value in values]}}


def deform(target,param,value,operations):
    return {'operation':'rig_deform','request':{'changes':[
        {'target':target,'key':{param:value},'operations':operations}]}}


def controls(c,meshes):
    for side,letter in [('right','R'),('left','L')]:
        opening='ParamEye'+letter+'Open'
        white,iris,lash,closed=[meshes[name+'_'+side] for name in ['white','iris','lash','closed']]
        edits=[{'operation':'rig_edit_structure','request':{'edits':[
            {'action':'static','kind':'mesh','id':iris.split(':')[1],'masked_by':[white.split(':')[1]]}]}},
            seed(white,opening,[1,0]),seed(lash,opening,[1,0.5,0]),
            deform(white,opening,0,[{'type':'scale','factors':[1,0.015],'pivot':[0.5,0.65]}]),
            deform(lash,opening,0.5,[{'type':'scale','factors':[1,0.65]}, {'type':'translate','delta':[0,0.3]}]),
            deform(lash,opening,0,[{'type':'scale','factors':[1,0.25]}, {'type':'translate','delta':[0,0.58]}]),
            channels(white,opening,[(0,0),(0.04,1),(1,1)]),
            channels(iris,opening,[(0,0),(0.08,1),(1,1)]),
            channels(lash,opening,[(0,0),(0.25,1),(1,1)]),
            channels(closed,opening,[(0,1),(0.35,0),(1,0)])]
        batch(c,edits,'Authored eyelid and iris mask '+side)
        for param,axis,amount in [('ParamEyeBallX',0,0.16),('ParamEyeBallY',1,0.08)]:
            shapes=[]
            for value in [-1,1]:
                delta=[0,0];delta[axis]=value*amount
                shapes.append({'target':iris,'value':value,'operations':[{'type':'translate','delta':delta}]})
            c.edit('author_axis',parameter={'id':param},shapes=shapes)
        c.edit('author_axis',parameter={'id':'ParamBrowAngle'+letter,'min':-1,'max':1,'default':0},
            shapes=[{'target':meshes['brow_'+side],'value':v,'operations':[
                {'type':'rotate','degrees':v*12,'pivot':[0.5,0.5]}]} for v in [-1,1]])
    mouth,closed=meshes['mouth_open'],meshes['mouth_closed']
    batch(c,[seed(mouth,'ParamMouthOpenY',[0,1]),
        deform(mouth,'ParamMouthOpenY',0,[{'type':'scale','factors':[1,0.08],'pivot':[0.5,0.3]}]),
        channels(mouth,'ParamMouthOpenY',[(0,0),(0.2,1),(1,1)]),
        channels(closed,'ParamMouthOpenY',[(0,1),(0.2,0),(1,0)])], 'Authored mouth opening')
    c.edit('author_axis',parameter={'id':'ParamMouthForm'},shapes=[
        {'target':target,'value':v,'operations':[{'type':'scale','factors':[1+v*0.18,1]}]}
        for target in [mouth,closed] for v in [-1,1]])
    # Secondary movement stays on the same head mesh: no gaps at hair cut lines.
    head=meshes['head_base']
    c.edit('author_axis',parameter={'id':'ParamHairFront'},shapes=[
        {'target':head,'value':v,'selection':{'rect':[0,0.42,0.30,1],'feather':0.15},
         'operations':[{'type':'translate','delta':[v*0.006,0]}]} for v in [-1,1]])
    c.edit('author_axis',parameter={'id':'ParamHairBack'},shapes=[
        {'target':head,'value':v,'selection':{'rect':[0.77,0.30,1,0.91],'feather':0.15},
         'operations':[{'type':'translate','delta':[v*0.006,0]}]} for v in [-1,1]])


def skeleton(c):
    spec=c.call('skeleton_propose')[0]['spec']
    points={
        'upper_body':([512,893],[512,535]),'lower_body':([512,893],[512,979]),
        'head':([512,476],[512,140]),
        'arm_upper_r':([414,552],[331,761]),'arm_fore_r':([331,761],[263,873]),'hand_r':([263,873],[236,927]),
        'arm_upper_l':([617,552],[693,756]),'arm_fore_l':([693,756],[749,843]),'hand_l':([749,843],[790,919]),
        'leg_upper_r':([430,977],[420,1057]),'leg_lower_r':([420,1057],[407,1136]),'foot_r':([407,1136],[370,1460]),
        'leg_upper_l':([590,977],[604,1057]),'leg_lower_l':([604,1057],[622,1136]),'foot_l':([622,1136],[659,1460])}
    for bone in spec['bones']:
        bone['head'],bone['tail']=points[bone['id']]
        if bone['role']=='UPPER_ARM':bone.update(minAngle=-35,maxAngle=120)
        if bone['role']=='FOREARM':bone.update(minAngle=-130,maxAngle=130)
        if bone['role'] in ['THIGH','SHIN']:bone.update(minAngle=-35,maxAngle=45)
        if bone['role']=='FOOT':bone.update(minAngle=-20,maxAngle=20)
        if bone['role']=='HAND':bone.update(minAngle=-35,maxAngle=35)
    spec['sampling']={'tolerancePx':1.5,'minimumStepDegrees':15,'maxMeshKeyforms':240,'jointMeshSegments':8}
    (OUT/'skeleton-authored.json').write_text(json.dumps(spec,indent=2)+'\n')
    print('Baking corrected skeleton...',flush=True)
    c.edit('skeleton_put',spec=spec)


def main():
    with client() as c:
        objects=json.loads((OUT/'objects.json').read_text())
        meshes={o['layerId']:o['target'] for o in objects if o['target'].startswith('mesh:')}
        print('Authoring eyes and mouth...',flush=True);controls(c,meshes)
        skeleton(c)
        c.edit('project_save')
        data=c.call('workspace_overview',{'limit':200})[0]
        (OUT/'overview-authored.json').write_text(json.dumps(data,indent=2)+'\n')
        poses=[{}, {'ParamEyeBallX':-1},{'ParamEyeBallX':1},
            {'ParamEyeLOpen':0,'ParamEyeROpen':0},{'ParamEyeLOpen':0.5,'ParamEyeROpen':0.5},
            {'ParamMouthOpenY':1,'ParamMouthForm':1}]
        _,images=c.call('view_render_poses',{'viewport':{'mode':'canvas_rect','left':350,'top':235,'width':330,'height':245},
            'poses':poses,'columns':3,'target_long_edge':1600})
        for i,png in enumerate(images):(OUT/f'face-authored-{i}.png').write_bytes(png)
        print('Saved authored rig',flush=True)


if __name__=='__main__':main()
