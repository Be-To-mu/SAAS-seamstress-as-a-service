"""Depth frames → world-space point clouds (camera at the origin, z up)."""

from __future__ import annotations

import numpy as np
from scipy.ndimage import binary_erosion, median_filter

from .capture import Capture, Frame
from .segment import frame_mask


FLYING_PIXEL_M = 0.05


def frame_points(capture: Capture, frame: Frame, erode: int = 2) -> np.ndarray:
    """Back-project the masked depth of one frame to (N,3) world points.

    The mask is eroded first: LiDAR depth smears across the silhouette edge
    ("flying pixels"), so the outermost pixels are not trusted.
    """
    mask = frame_mask(capture, frame) & (frame.depth > 0.1)
    if erode:
        mask = binary_erosion(mask, iterations=erode)
    # Flying pixels in narrow gaps (arm/torso, between the legs) survive erosion;
    # drop any reading far from its neighbourhood's median depth.
    local = median_filter(np.where(mask, frame.depth, np.nan), size=5, mode="nearest")
    mask &= np.abs(frame.depth - local) < FLYING_PIXEL_M
    v, u = np.nonzero(mask)
    z = frame.depth[v, u].astype(np.float64)
    # Drop stray background readings that leaked through the mask.
    med = np.median(z) if len(z) else 0.0
    keep = np.abs(z - med) < 0.6
    u, v, z = u[keep], v[keep], z[keep]
    k = capture.intrinsics
    x = (u - k[0, 2]) * z / k[0, 0]
    y = (v - k[1, 2]) * z / k[1, 1]
    cam = np.stack([x, y, z], axis=1)
    return cam @ capture.world_from_camera.T


def all_points(capture: Capture, erode: int = 2) -> list[np.ndarray]:
    return [frame_points(capture, f, erode) for f in capture.frames]
