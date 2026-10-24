"""Estimate how far the person had turned in each frame, from the depth alone.

Frame-to-frame ICP underestimates the turn (a torso is nearly a cylinder, so
the visible surface barely changes shape). Instead every frame is scored
against an average body at every yaw on a 5° grid (arms, feet and front/back
make the body clearly non-symmetric), and dynamic programming picks the best
sequence that keeps turning one way at a plausible speed. The app asks the
person to start facing the camera, so the first frame is pinned at yaw 0; that
settles front/back, and continuity carries it through the turn.
"""

from __future__ import annotations

import numpy as np
from scipy.spatial import cKDTree

GRID_DEG = 5.0
MAX_STEP_DEG = 30.0  # most the person turns between two kept frames
TRIM = 0.8  # score with the best-matching 80% of points
VISIBLE_OFFSET = 0.10


def _rot_z(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def yaw_costs(clouds: list[np.ndarray], body: np.ndarray, max_points: int = 600, seed: int = 0) -> np.ndarray:
    """(N, K) trimmed mean distance of each frame's points to `body` at each grid yaw."""
    rng = np.random.default_rng(seed)
    tree = cKDTree(body)
    grid = np.radians(np.arange(0, 360, GRID_DEG))
    out = np.empty((len(clouds), len(grid)))
    for i, c in enumerate(clouds):
        p = c[rng.choice(len(c), min(max_points, len(c)), replace=False)]
        to_camera = -p.mean(0) / np.linalg.norm(p.mean(0))  # camera sits at the world origin
        for k, yaw in enumerate(grid):
            # Body → world is Rz(yaw) x + t, so world → body is Rz(-yaw)(p - t).
            q = (p - p.mean(0)) @ _rot_z(yaw)  # row-vector form of Rz(-yaw)
            # The visible half of the body lies ~10 cm towards the camera from its centre.
            t = body.mean(0) + VISIBLE_OFFSET * (to_camera @ _rot_z(yaw))
            for _ in range(5):  # a few translation-only ICP steps
                d, idx = tree.query(q + t)
                keep = d <= np.quantile(d, TRIM)
                t = t + (body[idx[keep]] - (q + t)[keep]).mean(0)
            d, _ = tree.query(q + t)
            out[i, k] = np.sort(d)[: int(TRIM * len(d))].mean()
    return out


def best_sequence(costs: np.ndarray, start_facing: bool = True) -> np.ndarray:
    """Viterbi over the yaw grid for both turning directions; returns unwrapped yaws (rad)."""
    n, k = costs.shape
    max_steps = int(MAX_STEP_DEG / GRID_DEG)
    norm = costs / np.median(costs)
    best = None
    for direction in (1, -1):
        acc = norm[0].copy()
        if start_facing:
            acc[1:] = np.inf
        back = np.zeros((n, k), dtype=int)
        for i in range(1, n):
            cand = np.stack([np.roll(acc, direction * s) for s in range(max_steps + 1)])  # (S,K)
            s_best = cand.argmin(0)
            back[i] = (np.arange(k) - direction * s_best) % k
            acc = cand.min(0) + norm[i]
        end = int(acc.argmin())
        if best is None or acc[end] < best[0]:
            path = [end]
            for i in range(n - 1, 0, -1):
                path.append(back[i, path[-1]])
            best = (acc[end], path[::-1])
    yaws = np.radians(np.asarray(best[1]) * GRID_DEG)
    return np.unwrap(yaws)


def estimate_yaws(clouds: list[np.ndarray], body: np.ndarray, seed: int = 0, start_facing: bool = True) -> np.ndarray:
    return best_sequence(yaw_costs(clouds, body, seed=seed), start_facing)


def vision_yaws(capture, clouds: list[np.ndarray], body: np.ndarray, frames: list[int]) -> np.ndarray | None:
    """Turn angles from the app's raw Vision 3D body pose, or None.

    Vision's camera axis convention isn't documented precisely, so all eight
    axis-sign choices are tried and the one whose angles best match the depth
    (scored against an average body) wins.
    """
    hips = []
    for i in frames:
        v = capture.frames[i].vision
        if not v:
            return None
        c = np.asarray(v["camera_origin_matrix_columns"], dtype=np.float64).T  # 4x4, root → camera origin
        axis_body = np.asarray(v["left_hip"]) - np.asarray(v["right_hip"])
        hips.append(c[:3, :3].T @ axis_body)  # hip axis in Vision camera coordinates
    hips = np.asarray(hips)
    check = list(range(0, len(frames), max(1, len(frames) // 12)))
    costs = yaw_costs([clouds[k] for k in check], body)
    best = None
    for sx in (1, -1):
        for sy in (1, -1):
            for sz in (1, -1):
                world = (hips * [sx, sy, sz]) @ capture.world_from_camera.T
                # Anny's left is +x, so the left-minus-right hip axis gives the yaw directly.
                yaw = np.arctan2(world[:, 1], world[:, 0])
                k = np.round(np.degrees(yaw[check]) / GRID_DEG).astype(int) % costs.shape[1]
                score = costs[np.arange(len(check)), k].mean()
                if best is None or score < best[0]:
                    best = (score, yaw)
    return np.unwrap(best[1])
