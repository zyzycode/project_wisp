"""Separate alpha silhouettes even when thin antialiased fringes touch."""
import numpy as np
from PIL import Image
from scipy import ndimage


def extract_reviewed(image, count=4):
    data = np.array(image)
    if image.mode != 'RGBA' or data[:, :, 3].min() != 0:
        raise ValueError('Expected transparent RGBA input')
    alpha = data[:, :, 3]
    # Erosion finds interior seeds only; original alpha is restored on export.
    seeds = alpha > 128
    for radius in range(6):
        mask = ndimage.binary_erosion(seeds, iterations=radius) if radius else seeds
        labels, _ = ndimage.label(mask)
        sizes = np.bincount(labels.ravel())
        ids = np.flatnonzero(sizes[1:] > 1500) + 1
        if len(ids) == count:
            break
    else:
        raise ValueError(f'Cannot separate {count} character interiors')
    ids = sorted(ids, key=lambda value: np.where(labels == value)[1].mean())
    markers = np.zeros(alpha.shape, dtype=np.uint8)
    for index, value in enumerate(ids, 1):
        markers[labels == value] = index
    nearest = ndimage.distance_transform_edt(markers == 0, return_distances=False, return_indices=True)
    ownership = markers[nearest[0], nearest[1]]
    result = []
    for index in range(1, count+1):
        owned = (ownership == index) & (alpha > 0)
        parts, _ = ndimage.label(owned)
        part_sizes = np.bincount(parts.ravel())
        part_sizes[0] = 0
        core = parts == part_sizes.argmax()
        # Retain the source's antialiasing next to the selected silhouette,
        # excluding detached particles elsewhere in its cell.
        selected = owned & ndimage.binary_dilation(core, iterations=2)
        yy, xx = np.where(selected)
        left, right, top, bottom = xx.min(), xx.max()+1, yy.min(), yy.max()+1
        cell = data[top:bottom, left:right].copy()
        cell[:, :, 3] = np.where(selected[top:bottom, left:right], cell[:, :, 3], 0)
        result.append(Image.fromarray(cell))
    return result
