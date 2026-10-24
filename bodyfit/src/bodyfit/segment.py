"""Find the person in raw LiDAR depth when the app sent no person mask.

Gravity is known and the person stands on the floor in the middle of the
picture. So: drop everything at floor level, then take the depth-continuous
region around the nearest point in the centre of the image. Walls and
furniture behind the person are separated from them by a jump in depth.
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage

from .capture import Capture, Frame

FLOOR_MARGIN = 0.015  # metres above the floor that still count as floor
DEPTH_JUMP = 0.06  # neighbouring pixels further apart than this are not connected
CENTRE = 0.3  # the seed is searched in this central fraction of the image


def backproject(capture: Capture, depth: np.ndarray) -> np.ndarray:
    """(H,W,3) world points for every pixel (NaN where there is no reading)."""
    h, w = depth.shape
    k = capture.intrinsics
    v, u = np.mgrid[0:h, 0:w]
    z = np.where(depth > 0.1, depth, np.nan).astype(np.float64)
    cam = np.stack([(u - k[0, 2]) * z / k[0, 0], (v - k[1, 2]) * z / k[1, 1], z], -1)
    return cam @ capture.world_from_camera.T


def floor_height(points: np.ndarray) -> float:
    """Height of the lowest dense horizontal layer below the camera (the floor).

    Taking the most common low height instead picks up benches and tables.
    """
    z = points[..., 2][np.isfinite(points[..., 2])]
    z = z[z < -0.2]  # the phone stands well above the floor
    if len(z) < 100:
        raise ValueError("no floor visible below the phone")
    hist, edges = np.histogram(z, bins=np.arange(z.min(), z.max() + 0.01, 0.01))
    dense = np.nonzero(hist >= 0.25 * hist.max())[0]
    i = dense[0]
    return float(0.5 * (edges[i] + edges[i + 1]))


def person_mask(capture: Capture, depth: np.ndarray, floor: float) -> np.ndarray:
    pts = backproject(capture, depth)
    valid = np.isfinite(pts[..., 2]) & (pts[..., 2] > floor + FLOOR_MARGIN)
    # Cut connections across depth jumps (silhouette edges against the room).
    d = np.where(depth > 0.1, depth, np.inf)
    barrier = np.zeros_like(valid)
    barrier[:, :-1] |= np.abs(np.diff(d, axis=1)) > DEPTH_JUMP
    barrier[:-1, :] |= np.abs(np.diff(d, axis=0)) > DEPTH_JUMP
    labels, _ = ndimage.label(valid & ~barrier)

    h, w = depth.shape
    r0, r1 = int(h * (0.5 - CENTRE / 2)), int(h * (0.5 + CENTRE / 2))
    c0, c1 = int(w * (0.5 - CENTRE / 2)), int(w * (0.5 + CENTRE / 2))
    centre = np.where(labels[r0:r1, c0:c1] > 0, d[r0:r1, c0:c1], np.inf)
    if not np.isfinite(centre).any():
        return np.zeros_like(valid)
    r, c = np.unravel_index(np.argmin(centre), centre.shape)
    mask = labels == labels[r0 + r, c0 + c]
    # Give back the edge pixels the barrier removed; erosion later drops the unreliable ones.
    return ndimage.binary_dilation(mask) & valid


def segment(capture: Capture) -> None:
    """Fill in `frame.mask` for frames recorded without one."""
    floor = floor_height(backproject(capture, capture.frames[0].depth))
    for f in capture.frames:
        if f.mask is None:
            f.mask = person_mask(capture, f.depth, floor)
    capture.meta.setdefault("segmentation", {"floor_z": floor})


def frame_mask(capture: Capture, frame: Frame) -> np.ndarray:
    if frame.mask is None:
        segment(capture)
    if frame.mask.shape != frame.depth.shape and frame.mask.T.shape == frame.depth.shape:
        frame.mask = frame.mask.T
    return frame.mask
