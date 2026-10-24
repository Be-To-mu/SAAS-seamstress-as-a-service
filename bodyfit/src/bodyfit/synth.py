"""Synthetic turn scans: render known Anny bodies as an iPhone LiDAR would see them.

Lets the fitter and measurements be tested against ground truth without a person.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
import torch
import trimesh
from scipy.ndimage import binary_dilation

from .capture import Capture, Frame
from .model import PHENOTYPES, POSE_BONES, BodyModel, Shape, age_param


@dataclass
class SynthSettings:
    n_frames: int = 72
    width: int = 240  # portrait LiDAR depth map
    height: int = 320
    focal: float = 262.0  # px at depth resolution (~63° vertical FOV)
    distance: float = 2.2  # camera → person, metres
    camera_height: float = 1.0
    camera_pitch_deg: float = 5.0  # tilted down on the stand
    depth_noise: float = 0.005  # metres, per pixel
    depth_bias: float = 0.002  # metres, per frame
    yaw_hint_noise_deg: float = 8.0
    sway: float = 0.02  # metres the person drifts while turning
    arm_jitter_deg: float = 2.0
    wall_behind: float = 1.5  # metres behind the person
    with_mask: bool = False  # the app sends no masks; bodyfit.segment finds the person


def world_from_camera(pitch_deg: float) -> np.ndarray:
    m = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], dtype=np.float64)
    a = -math.radians(pitch_deg)
    rx = np.array([[1, 0, 0], [0, math.cos(a), -math.sin(a)], [0, math.sin(a), math.cos(a)]])
    return rx @ m


def rot_z(theta: float) -> np.ndarray:
    c, s = math.cos(theta), math.sin(theta)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def random_shape(model: BodyModel, rng: np.random.Generator) -> tuple[Shape, float]:
    """A random adult body and its age in years."""
    years = float(rng.uniform(18, 75))
    ph = {k: float(rng.uniform(0.15, 0.85)) for k in PHENOTYPES}
    ph["age"] = age_param(years)
    changes = {k: float(rng.uniform(-0.5, 0.5)) for k in model.change_labels}
    return Shape(ph, changes), years


def random_pose(rng: np.random.Generator) -> np.ndarray:
    """Small deviations from the A-pose, as a person roughly copying it would show."""
    rv = rng.normal(0.0, math.radians(4.0), size=(len(POSE_BONES), 3))
    for side, sign in (("L", 1.0), ("R", -1.0)):
        i = POSE_BONES.index(f"upperarm01.{side}")
        rv[i, 1] += sign * math.radians(rng.uniform(-10, 10))  # arms a bit higher/lower
    return rv


def render_turn(
    model: BodyModel,
    shape: Shape,
    pose: np.ndarray,
    settings: SynthSettings = SynthSettings(),
    seed: int = 0,
) -> Capture:
    s = settings
    rng = np.random.default_rng(seed)
    k = np.array([[s.focal, 0, s.width / 2], [0, s.focal, s.height / 2], [0, 0, 1]])
    w_from_c = world_from_camera(s.camera_pitch_deg)

    # Irregular turning speed, a little more than one full turn.
    steps = rng.uniform(0.6, 1.4, s.n_frames)
    yaws = np.concatenate([[0.0], np.cumsum(steps[:-1])])
    yaws *= 2 * math.pi * 1.05 / yaws[-1]
    drift = np.cumsum(rng.normal(0, s.sway / 6, (s.n_frames, 2)), axis=0)
    drift -= drift.mean(0)

    ph, ch = model.shape_tensors(shape)
    arm = [POSE_BONES.index(b) for b in POSE_BONES if "arm" in b]

    # Pixel rays in world space.
    # OpenCV convention, as Apple reports intrinsics: pixel (u, v) is centred on integer coordinates.
    uu, vv = np.meshgrid(np.arange(s.width, dtype=float), np.arange(s.height, dtype=float))
    dirs_c = np.stack([(uu - k[0, 2]) / k[0, 0], (vv - k[1, 2]) / k[1, 1], np.ones_like(uu)], -1)
    dirs_w = dirs_c.reshape(-1, 3) @ w_from_c.T
    room_depth = _room_depth(dirs_w, dirs_c.reshape(-1, 3), s).reshape(s.height, s.width)

    frames = []
    for i in range(s.n_frames):
        rv = pose.copy()
        rv[arm] += rng.normal(0, math.radians(s.arm_jitter_deg), (len(arm), 3))
        with torch.no_grad():
            v = model.forward(ph, ch, torch.tensor(rv[None], dtype=torch.float32))["vertices"][0].numpy()
        t = np.array([drift[i, 0], s.distance + drift[i, 1], -s.camera_height - v[:, 2].min()])
        vw = v @ rot_z(yaws[i]).T + t
        depth, hit = _raycast(vw, model.faces, dirs_w, w_from_c, k, s)

        depth = depth + rng.normal(0, s.depth_noise, depth.shape) + rng.normal(0, s.depth_bias)
        # Room: floor under the person, a wall behind. Edge pixels mix person and room depth.
        room = room_depth + rng.normal(0, s.depth_noise, room_depth.shape)
        mask = binary_dilation(hit, iterations=1)
        ring = mask & ~hit
        mix = rng.uniform(0, 1, depth.shape)
        depth = np.where(ring, mix * room + (1 - mix) * s.distance, depth)
        depth = np.where(hit | ring, depth, room).astype(np.float32)
        if not s.with_mask:
            mask = None

        hint = yaws[i] + rng.normal(0, math.radians(s.yaw_hint_noise_deg))
        frames.append(Frame(depth=depth, mask=mask, yaw_hint=float(hint), time=i / 4.0))

    truth = {
        "shape": {"phenotypes": shape.phenotypes, "changes": shape.changes},
        "pose_rotvec": pose.tolist(),
        "yaw": yaws.tolist(),
    }
    return Capture(k, w_from_c, frames, meta={"synthetic": True, "seed": seed, "truth": truth})


def _room_depth(dirs_w, dirs_c, s):
    """Camera-z depth of the floor (z = -camera_height) and a wall behind the person."""
    with np.errstate(divide="ignore", invalid="ignore"):
        t_floor = np.where(dirs_w[:, 2] < 0, -s.camera_height / dirs_w[:, 2], np.inf)
        t_wall = np.where(dirs_w[:, 1] > 0, (s.distance + s.wall_behind) / dirs_w[:, 1], np.inf)
    t = np.minimum(t_floor, t_wall)
    return np.where(np.isfinite(t), t * dirs_c[:, 2], 0.0)


def _raycast(vw, faces, dirs_w, w_from_c, k, s):
    mesh = trimesh.Trimesh(vw, faces, process=False)
    # Only cast rays inside the person's projected bounding box.
    cam = vw @ w_from_c  # world → camera (orthonormal)
    u = cam[:, 0] / cam[:, 2] * k[0, 0] + k[0, 2]
    v = cam[:, 1] / cam[:, 2] * k[1, 1] + k[1, 2]
    u0, u1 = int(max(0, u.min() - 2)), int(min(s.width, u.max() + 3))
    v0, v1 = int(max(0, v.min() - 2)), int(min(s.height, v.max() + 3))
    pix = (np.arange(v0, v1)[:, None] * s.width + np.arange(u0, u1)[None, :]).reshape(-1)

    origins = np.zeros((len(pix), 3))
    locs, ray_idx, _ = mesh.ray.intersects_location(origins, dirs_w[pix], multiple_hits=False)
    depth = np.zeros(s.width * s.height)
    hit = np.zeros(s.width * s.height, dtype=bool)
    depth[pix[ray_idx]] = (locs @ w_from_c)[:, 2]
    hit[pix[ray_idx]] = True
    return depth.reshape(s.height, s.width), hit.reshape(s.height, s.width)
