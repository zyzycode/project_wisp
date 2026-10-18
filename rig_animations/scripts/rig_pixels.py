"""Pixel-preserving masks and bounded hidden-surface preparation for this source."""
from collections import deque
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SIZE = (1024, 1536)


def polygon(points, smooth=False):
    scale = 4 if smooth else 1
    image = Image.new("L", (SIZE[0]*scale, SIZE[1]*scale))
    ImageDraw.Draw(image).polygon([(x*scale,y*scale) for x,y in points], fill=255)
    if smooth:
        image = image.resize(SIZE, Image.LANCZOS)
    return np.array(image)


def rectangle(box):
    x0,y0,x1,y1=box
    return polygon([(x0,y0),(x1,y0),(x1,y1),(x0,y1)])


def extract(pixels, mask):
    result=pixels.copy()
    result[:,:,3]=(result[:,:,3].astype(np.uint16)*mask//255).astype(np.uint8)
    result[result[:,:,3]==0]=0
    return result


def largest_alpha(pixels):
    available=pixels[:,:,3]>16
    visited=np.zeros(available.shape,dtype=bool)
    queue=deque([(600,512)]); visited[600,512]=True
    while queue:
        y,x=queue.popleft()
        for dy,dx in [(0,1),(0,-1),(1,0),(-1,0)]:
            yy,xx=y+dy,x+dx
            if 0<=yy<SIZE[1] and 0<=xx<SIZE[0] and available[yy,xx] and not visited[yy,xx]:
                visited[yy,xx]=True;queue.append((yy,xx))
    support=np.array(Image.fromarray(visited.astype(np.uint8)*255).filter(ImageFilter.MaxFilter(5)))>0
    result=pixels.copy();result[~support]=0
    return result


def connected(mask, seed):
    found=np.zeros(mask.shape,dtype=np.uint8)
    queue=deque([seed]);found[seed]=255
    while queue:
        y,x=queue.popleft()
        for dy,dx in [(0,1),(0,-1),(1,0),(-1,0)]:
            yy,xx=y+dy,x+dx
            if 0<=yy<mask.shape[0] and 0<=xx<mask.shape[1] and mask[yy,xx] and not found[yy,xx]:
                found[yy,xx]=255;queue.append((yy,xx))
    return found


def skin_surface(pixels):
    yy,xx=np.indices(pixels.shape[:2])
    r,g,b=[pixels[:,:,i].astype(float) for i in range(3)]
    samples=(xx>381)&(xx<651)&(yy>295)&(yy<451)&(r>240)&(g>180)&(g<236)&(r-g>14)&(g-b>13)&(g-b<40)
    # Local skin colors are fitted; no diffusion or replacement character image.
    features=np.stack([np.ones_like(xx), (xx-515)/150, (yy-365)/100],axis=-1)
    coefficients=np.linalg.lstsq(features[samples],pixels[samples,:3],rcond=None)[0]
    rgb=np.clip(features@coefficients,0,255).astype(np.uint8)
    return np.dstack([rgb,np.full(xx.shape,255,dtype=np.uint8)])


def patch(base, replacement, mask):
    weight=mask[:,:,None].astype(float)/255
    result=base.copy()
    result[:,:,:3]=np.rint(base[:,:,:3]*(1-weight)+replacement[:,:,:3]*weight).astype(np.uint8)
    return result


def shifted_scaled(part, y_scale, target_y, source_y):
    # Only a lash/lip texture is reshaped, never an entire eye or generated frame.
    image=Image.fromarray(part)
    return np.array(image.transform(SIZE,Image.AFFINE,
        (1,0,0,0,1/y_scale,source_y-target_y/y_scale),Image.BICUBIC))
