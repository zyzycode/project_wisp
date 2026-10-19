"""Extract visible bracelet pixels with technical alpha masks; no RGB repainting."""
from PIL import Image, ImageDraw
from pathlib import Path
import json
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'work/arm-01/r13-bracelets'
OUT.mkdir(parents=True,exist_ok=True)
source=ROOT/'character_reference.png'
im=Image.open(source).convert('RGBA')
points={
 'bracelet_blue_L':[(756,805),(761,805),(766,808),(769,813),(771,819),(769,823),(765,827),(759,831),(751,836),(741,841),(730,844),(720,845),(715,842),(712,838),(711,832),(712,827),(715,824),(719,825),(725,823),(734,819),(743,814),(751,809)],
 'bracelet_red_L':[(768,817),(772,819),(775,823),(777,828),(777,832),(774,837),(768,842),(760,846),(752,850),(742,854),(732,856),(725,856),(721,854),(719,850),(720,845),(723,842),(734,839),(746,834),(757,828),(765,822)]}
record={}
for name,contour in points.items():
 scale=4
 mask=Image.new('L',(im.width*scale,im.height*scale))
 ImageDraw.Draw(mask).polygon([(int(x*scale),int(y*scale)) for x,y in contour],fill=255)
 mask=mask.resize(im.size,Image.LANCZOS)
 rgba=np.array(im); ma=np.array(mask)
 r,g,b=rgba[:,:,:3].astype(float).transpose(2,0,1)
 if 'blue' in name:
  confidence=np.minimum(np.clip((b-r-8)/15,0,1),np.clip((b-g-2)/10,0,1))
 else:
  confidence=np.minimum(np.clip((r-1.7*g)/14,0,1),np.clip((r-1.7*b)/14,0,1))
 ma=(ma*confidence).astype('uint8'); mask=Image.fromarray(ma)
 rgba[:,:,3]=(rgba[:,:,3].astype('uint16')*ma//255).astype('uint8')
 out=Image.fromarray(rgba)
 box=out.getbbox(); crop=out.crop(box)
 crop.save(OUT/(name+'.png'));mask.save(OUT/(name+'-mask.png'))
 record[name]={'bbox':box,'size':crop.size,'contour':contour}
preview=Image.new('RGBA',(88,74),(238,238,238,255))
for name in ['bracelet_red_L','bracelet_blue_L']:
 p=Image.open(OUT/(name+'.png')); x,y,_,_=record[name]['bbox'];preview.alpha_composite(p,(x-704,y-794))
preview.resize((704,592),Image.NEAREST).save(OUT/'preview-x8.png')
(OUT/'recipe-draft.json').write_text(json.dumps(record,indent=2)+'\n')
