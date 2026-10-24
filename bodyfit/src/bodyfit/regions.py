"""Where on the body the measurements are taken.

The fit spends its points (and the detail layer its freedom) in these bands;
elsewhere a few points are enough to keep the overall shape sensible.
Heights are fractions of standing height above the floor.
"""

from __future__ import annotations

import numpy as np

BANDS = {
    "calf": (0.17, 0.24),
    "knee": (0.26, 0.31),
    "thigh": (0.38, 0.46),
    "hip": (0.46, 0.57),
    "waist": (0.57, 0.65),
    "chest": (0.68, 0.80),
    "neck": (0.80, 0.87),
    "head_top": (0.96, 1.01),
}
SOLES = 0.03  # metres above the floor, for height and inseam
UPPER_ARM = (0.62, 0.80)  # height band, only points out to the side
ARM_OFFSET = 0.15  # metres sideways from the body axis
IN_BAND_SHARE = 0.8  # share of each frame's sample drawn from the bands


def in_bands(z_above_floor: np.ndarray, height: float, sideways: np.ndarray) -> np.ndarray:
    """Boolean mask of points (or vertices) that lie in a measurement band."""
    h = z_above_floor / height
    mask = z_above_floor < SOLES
    for lo, hi in BANDS.values():
        mask |= (h >= lo) & (h < hi)
    mask |= (h >= UPPER_ARM[0]) & (h < UPPER_ARM[1]) & (sideways > ARM_OFFSET)
    return mask


class BandSampler:
    """Per frame, draws most points from the measurement bands and a few from elsewhere."""

    def __init__(self, clouds: list[np.ndarray], floor_z: float, seed: int = 0, top: float | None = None):
        self.rng = np.random.default_rng(seed)
        if top is None:
            top = max(float(c[:, 2].max()) for c in clouds)
        self.floor_z = floor_z
        self.height = top - floor_z
        self.band_idx, self.other_idx = [], []
        for c in clouds:
            axis = np.median(c[:, :2], axis=0)
            mask = in_bands(c[:, 2] - floor_z, self.height, np.linalg.norm(c[:, :2] - axis, axis=1))
            band, other = np.nonzero(mask)[0], np.nonzero(~mask)[0]
            # A frame with no band points (shouldn't happen) falls back to uniform.
            self.band_idx.append(band if len(band) else np.arange(len(c)))
            self.other_idx.append(other if len(other) else np.arange(len(c)))

    def indices(self, frame: int, n: int, band_share: float = IN_BAND_SHARE) -> np.ndarray:
        k = int(round(n * band_share))
        a = self.band_idx[frame][self.rng.integers(0, len(self.band_idx[frame]), k)]
        b = self.other_idx[frame][self.rng.integers(0, len(self.other_idx[frame]), n - k)]
        return np.concatenate([a, b])


def vertex_band_weights(vertices: np.ndarray, faces: np.ndarray, smooth_steps: int = 8) -> np.ndarray:
    """0..1 per model vertex: 1 inside measurement bands, fading out over a few rings.

    Used to keep the detail layer to the measured regions without hard seams.
    """
    floor = vertices[:, 2].min()
    height = vertices[:, 2].max() - floor
    sideways = np.abs(vertices[:, 0])
    w = in_bands(vertices[:, 2] - floor, height, sideways).astype(np.float64)
    # Average with neighbours a few times so the edges of each band taper.
    nbr = [[] for _ in range(len(vertices))]
    for a, b, c in faces:
        nbr[a] += [b, c]
        nbr[b] += [a, c]
        nbr[c] += [a, b]
    rows = np.repeat(np.arange(len(vertices)), [len(n) for n in nbr])
    cols = np.concatenate([np.asarray(n, dtype=np.int64) for n in nbr])
    deg = np.bincount(rows, minlength=len(vertices)).astype(np.float64)
    for _ in range(smooth_steps):
        w = 0.5 * w + 0.5 * np.bincount(rows, weights=w[cols], minlength=len(vertices)) / np.maximum(deg, 1)
    return np.clip(w * 1.5, 0, 1)
