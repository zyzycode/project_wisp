"""Prepare the first complete frontal source layout, preserving visible source art."""
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

from rig_pixels import SIZE, connected, extract, largest_alpha, patch, polygon, rectangle, shifted_scaled, skin_surface
from prepare_mask_test import POLYGONS, EXPECTED

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'work/full-rig-v1/source'

EYES={
 'right':[(395,338),(401,330),(414,325),(430,323),(449,325),(466,333),(471,345),
          (469,361),(462,377),(451,386),(436,389),(420,384),(407,374),(400,360)],
 'left':[(566,333),(582,324),(601,323),(620,327),(634,335),(639,348),
         (634,365),(626,377),(609,385),(591,389),(574,381),(565,366),(562,350)]}


def main():
    source=ROOT/'character_reference.png'
    assert hashlib.sha256(source.read_bytes()).hexdigest()==EXPECTED
    original=np.array(Image.open(source).convert('RGBA'))
    pixels=largest_alpha(original)
    OUT.mkdir(parents=True,exist_ok=True)
    layers=[]; composite=Image.new('RGBA',SIZE)
    def add(name,part,tags,visible=True):
        nonlocal composite
        image=Image.fromarray(part)
        bounds=image.getbbox()
        if bounds is None: raise ValueError('Empty part: '+name)
        crop=image.crop(bounds);crop.save(OUT/(name+'.png'))
        layers.append({'id':name,'name':name,'image':{'path':name+'.png','width':crop.width,'height':crop.height},
            'rect':{'left':bounds[0],'top':bounds[1],'width':crop.width,'height':crop.height},'tags':tags})
        if visible: composite=Image.alpha_composite(composite,image)
    head_mask=polygon([(0,0),(1023,0),(1023,493),(600,493),(572,488),(550,473),
        (548,456),(533,460),(515,462),(495,460),(480,455),(477,476),(452,498),
        (444,553),(410,527),(367,499),(0,499)])
    body=extract(pixels,255-head_mask)
    # Arms include their sleeves. Overlap at each shoulder remains under the torso.
    arm_r=polygon([(0,500),(422,513),(431,535),(419,578),(401,642),(380,711),
        (356,750),(339,789),(319,831),(293,873),(278,950),(0,985)])
    arm_l=polygon([(608,515),(1023,500),(1023,985),(742,950),(740,877),(712,825),
        (687,778),(659,728),(642,677),(631,616),(613,566)])
    leg_r=rectangle((200,983,510,1535));leg_l=rectangle((511,983,850,1535))
    for side,mask in [('right',leg_r),('left',leg_l)]:
        leg=extract(body,mask)
        boot_mask=polygon([(0,1123),(350,1123),(400,1145),(463,1135),(511,1118),
            (558,1134),(618,1145),(676,1117),(1023,1117),(1023,1535),(0,1535)])
        add('leg_'+side,extract(leg,255-boot_mask),['leg',side])
        add('boot_'+side,extract(leg,boot_mask),['foot',side])
    torso_hull=polygon([(420,490),(608,490),(635,620),(653,720),(648,760),
        (661,820),(689,880),(700,982),(320,982),(337,883),(363,790),(380,716),(401,642)])
    residual=255-np.maximum.reduce([torso_hull,leg_r,leg_l])
    arm_r=np.maximum(arm_r,np.minimum(residual,rectangle((0,500,510,982))))
    arm_l=np.maximum(arm_l,np.minimum(residual,rectangle((511,500,1023,982))))
    for side,mask,point in [('right',arm_r,(750,340)),('left',arm_l,(750,690))]:
        arm=extract(body,mask)
        support=connected(arm[:,:,3]>16,point)
        support=np.array(Image.fromarray(support).filter(ImageFilter.MaxFilter(5)))
        add('arm_'+side,extract(arm,support),['arm',side])
    removed=np.maximum.reduce([arm_r,arm_l,leg_r,leg_l])
    # A 10-pixel overlap retains original shoulder pixels behind the sleeve joint.
    shoulder_overlap=np.array(Image.fromarray(removed).filter(ImageFilter.MinFilter(21)))
    removed[500:620]=shoulder_overlap[500:620]
    torso=extract(body,np.minimum(255-removed,torso_hull))
    neck_mask=rectangle((460,445,570,522))
    shorts_mask=rectangle((320,893,710,1010))
    add('shorts',extract(torso,shorts_mask),['bottom'])
    add('shirt',extract(torso,255-np.maximum(neck_mask,shorts_mask)),['top'])
    neck=extract(body,neck_mask)
    # Extend the neck upward, hidden behind the original head at rest.
    neck_image=Image.new('RGBA',SIZE)
    neck_crop=Image.fromarray(pixels).crop((486,466,543,470)).resize((57,30))
    neck_image.paste(neck_crop,(486,438))
    neck_image=Image.alpha_composite(neck_image,Image.fromarray(neck))
    add('neck',np.array(neck_image),['neck'])
    head=extract(pixels,head_mask)
    surface=skin_surface(pixels)
    feature_masks=[]; eye_parts=[]
    yy,xx=np.indices(pixels.shape[:2])
    for side,points in EYES.items():
        roi=rectangle((371,303,481,394) if side=='right' else (554,303,660,394))
        iris_mask=polygon(POLYGONS['iris_'+side],smooth=True)
        white_mask=polygon(points,smooth=True)
        # Rebuild only the sclera hidden under the iris; retain visible source whites.
        shade=np.clip(233+(yy-326)*0.34,230,253).astype(np.uint8)
        white=np.dstack([shade,shade,shade,np.full(shade.shape,255,dtype=np.uint8)])
        original_white=(pixels[:,:,:3].max(2).astype(int)-pixels[:,:,:3].min(2)<19)&(pixels[:,:,0]>180)
        iris_region=np.array(Image.fromarray(iris_mask).filter(ImageFilter.MaxFilter(7)))>0
        original_white &= ~iris_region
        white[original_white]=pixels[original_white]
        white=extract(white,white_mask)
        dark=(pixels[:,:,:3].max(2)<130)&(iris_mask<32)&(roi>0)
        lash_mask=connected(dark,(317,425) if side=='right' else (317,600))
        lash_mask=np.array(Image.fromarray(lash_mask).filter(ImageFilter.MaxFilter(3)))
        lash=extract(pixels,lash_mask)
        # Remove isolated dark iris outlines below the upper lash.
        lash[yy>358]=0
        closed=shifted_scaled(lash,-0.24,366,327)
        features=np.maximum(white_mask,np.array(Image.fromarray(lash[:,:,3]).filter(ImageFilter.MaxFilter(3))))
        features=np.maximum(features,iris_mask)
        feature_masks.append(features)
        # Face-detail classification deliberately bypasses automatic blink/gaze.
        # The following authoring stage binds these explicitly, with real clipping.
        eye_parts += [('white_'+side,white,['face','detail',side],True),
                      ('iris_'+side,extract(pixels,iris_mask),['face','detail',side],True),
                      ('lash_'+side,lash,['face','detail',side],True),
                      ('closed_'+side,closed,['face','detail',side],False)]
    brow_parts=[]
    for side,points in [('right',[(390,284),(402,275),(428,267),(434,275),(405,283),(393,290)]),
                        ('left',[(558,276),(584,269),(610,274),(626,285),(604,283),(581,279)])]:
        mask=polygon(points)
        blue=pixels[:,:,2].astype(int)-pixels[:,:,0].astype(int)>22
        mask[~blue]=0
        brow_parts.append(('brow_'+side,extract(pixels,mask),['brow',side],True))
        feature_masks.append(mask)
    mouth_mask=polygon([(497,412),(506,410),(524,411),(535,415),(532,423),(526,429),
        (515,432),(505,428),(499,421)],smooth=True)
    mouth=extract(pixels,mouth_mask);feature_masks.append(mouth_mask)
    union=np.maximum.reduce(feature_masks)
    erase=np.array(Image.fromarray(union).filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(0.65)))
    r,g,b=[pixels[:,:,i].astype(int) for i in range(3)]
    skin=(r>190)&(r-g>9)&(g-b>9)
    erase[~skin & (union==0)]=0
    head=patch(head,surface,erase)
    add('head_base',head,['face'])
    for item in eye_parts+brow_parts: add(*item)
    add('mouth_open',mouth,['face','detail'])
    add('mouth_closed',shifted_scaled(mouth,0.16,416,416),['face','detail'],False)
    manifest={'format':'psd2live-layout','version':1,'name':'Wisp frontal rig v1',
        'canvas':{'width':SIZE[0],'height':SIZE[1]},'layers':layers}
    (OUT/'layout.json').write_text(json.dumps(manifest,indent=2)+'\n')
    composite.save(OUT/'assembled.png')
    composite.crop((355,255,675,465)).resize((960,630)).save(OUT/'face-assembled.png')
    Image.fromarray(erase).save(OUT/'reconstructed-skin-mask.png')
    report={'source_sha256':EXPECTED,'parts':len(layers),'source_file_unchanged':True,
        'reconstructed_regions':['skin behind eyes/brows/mouth','sclera behind irises','neck overlap'],
        'derived_textures':['closed lashes from upper lashes','closed lip from original mouth'],
        'scope':'frontal 2D puppet; no unseen side/back artwork',
        'part_ids':[p['id'] for p in layers]}
    (OUT/'preparation.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__': main()
