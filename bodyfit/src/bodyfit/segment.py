"""Find the person in raw LiDAR depth without image segmentation.

The phone is level-ish on a stand (gravity is known), the person stands on the
floor in open space. So: everything above the floor and within a cylinder around
where they stand is the person.
"""

from __future__ import annotations

import numpy as np

from .capture import Capture, Frame

FLOOR_MARGIN = 0.015  # metres above the floor plane that still count as floor
RADIUS = 0.6  # metres around the person's standing axis
MAX_HEIGHT = 2.3


def backproject(capture: Capture, depth: np.ndarray) -> np.ndarray:
    """(H,W,3) world points for every pixel (NaN where there is no reading)."""
    h, w = depth.shape
    k = capture.intrinsics
    v, u = np.mgrid[0:h, 0:w]
    z = np.where(depth > 0.1, depth, np.nan).astype(np.float64)
    cam = np.stack([(u - k[0, 2]) * z / k[0, 0], (v - k[1, 2]) * z / k[1, 1], z], -1)
    return cam @ capture.world_from_camera.T


def floor_height(points: np.ndarray) -> float:
    """Height of the dominant low horizontal plane (the floor)."""
    z = points[..., 2][np.isfinite(points[..., 2])]
    low = z[z < np.quantile(z, 0.3)]
    hist, edges = np.histogram(low, bins=np.arange(low.min(), low.max() + 0.01, 0.005))
    i = int(np.argmax(hist))
    return float(0.5 * (edges[i] + edges[i + 1]))


def person_axis(points: np.ndarray, floor: float) -> np.ndarray:
    """Horizontal (x, y) of the person: the nearest tall cluster in front of the camera."""
    p = points[np.isfinite(points[..., 2])]
    torso = p[(p[:, 2] > floor + 0.6) & (p[:, 2] < floor + 1.4) & (np.abs(p[:, 0]) < 1.0)]
    torso = torso[(torso[:, 1] > 0.8) & (torso[:, 1] < 4.0)]
    if len(torso) < 50:
        raise ValueError("no person found 0.8–4 m in front of the camera")
    near = torso[torso[:, 1] < np.quantile(torso[:, 1], 0.2) + 0.5]  # ignore walls behind
    return np.median(near[:, :2], axis=0)


def segment(capture: Capture) -> None:
    """Fill in `frame.mask` for frames recorded without one."""
    first = backproject(capture, capture.frames[0].depth)
    floor = floor_height(first)
    axis = person_axis(first, floor)
    for f in capture.frames:
        if f.mask is not None:
            continue
        pts = backproject(capture, f.depth)
        d = np.linalg.norm(pts[..., :2] - axis, axis=-1)
        z = pts[..., 2]
        f.mask = np.isfinite(z) & (z > floor + FLOOR_MARGIN) & (z < floor + MAX_HEIGHT) & (d < RADIUS)
    capture.meta.setdefault("segmentation", {"floor_z": floor, "axis_xy": axis.tolist()})


def frame_mask(capture: Capture, frame: Frame) -> np.ndarray:
    if frame.mask is None:
        segment(capture)
    return frame.mask
