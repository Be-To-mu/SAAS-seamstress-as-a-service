"""Capture bundle: what the iPhone app records during a turn scan (see docs/capture-format.md)."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image

FORMAT_VERSION = 1

# The iPhone's back camera sensor is natively landscape. With OpenCV camera axes
# (x right, y down, z forward) in that orientation, device axes (x right, y up,
# z out of the screen, in portrait) map like this:
CAMERA_FROM_DEVICE = np.array([[0, -1, 0], [-1, 0, 0], [0, 0, -1]], dtype=np.float64)


def world_from_gravity(gravity_device) -> np.ndarray:
    """World (z up, y = camera forward projected flat) from the phone's gravity vector."""
    g = CAMERA_FROM_DEVICE @ np.asarray(gravity_device, dtype=np.float64)
    up = -g / np.linalg.norm(g)
    fwd = np.array([0.0, 0.0, 1.0]) - up[2] * up
    fwd /= np.linalg.norm(fwd)
    right = np.cross(fwd, up)
    return np.stack([right, fwd, up])  # rows: world axes in camera coordinates


@dataclass
class Frame:
    depth: np.ndarray  # (H,W) float32 metres, 0 = no reading
    mask: np.ndarray | None  # (H,W) bool person pixels; None → found from geometry (segment.py)
    yaw_hint: float | None = None  # body yaw in radians, if known
    time: float = 0.0
    vision: dict | None = None  # raw Vision 3D body pose from the app (see turn.py)


@dataclass
class Capture:
    intrinsics: np.ndarray  # (3,3) at depth resolution
    world_from_camera: np.ndarray  # (3,3) rotation: camera (x right, y down, z forward) → world (z up)
    frames: list[Frame] = field(default_factory=list)
    meta: dict = field(default_factory=dict)

    @property
    def size(self) -> tuple[int, int]:
        h, w = self.frames[0].depth.shape
        return w, h

    def save(self, folder: str | Path) -> None:
        folder = Path(folder)
        (folder / "depth").mkdir(parents=True, exist_ok=True)
        (folder / "mask").mkdir(parents=True, exist_ok=True)
        entries = []
        for i, f in enumerate(self.frames):
            depth_mm = np.clip(np.round(f.depth * 1000.0), 0, 65535).astype(np.uint16)
            Image.fromarray(depth_mm).save(folder / f"depth/{i:04d}.png")
            if f.mask is not None:
                Image.fromarray(f.mask.astype(np.uint8) * 255).save(folder / f"mask/{i:04d}.png")
            entries.append(
                {
                    "depth": f"depth/{i:04d}.png",
                    "mask": f"mask/{i:04d}.png" if f.mask is not None else None,
                    "yaw_hint": f.yaw_hint,
                    "time": f.time,
                }
            )
        w, h = self.size
        doc = {
            "version": FORMAT_VERSION,
            "depth_size": [w, h],
            "intrinsics": self.intrinsics.tolist(),
            "world_from_camera": self.world_from_camera.tolist(),
            "frames": entries,
            "meta": self.meta,
        }
        (folder / "capture.json").write_text(json.dumps(doc, indent=2))

    @staticmethod
    def load(folder: str | Path) -> Capture:
        folder = Path(folder)
        doc = json.loads((folder / "capture.json").read_text())
        if doc["version"] != FORMAT_VERSION:
            raise ValueError(f"unsupported capture version {doc['version']}")
        frames = []
        for e in doc["frames"]:
            depth = np.asarray(Image.open(folder / e["depth"]), dtype=np.float32) / 1000.0
            mask = np.asarray(Image.open(folder / e["mask"])) > 127 if e.get("mask") else None
            frames.append(Frame(depth, mask, e.get("yaw_hint"), e.get("time", 0.0), e.get("vision")))
        if "world_from_camera" in doc:
            w_from_c = np.asarray(doc["world_from_camera"], dtype=np.float64)
        else:  # the iPhone app sends raw gravity instead
            w_from_c = world_from_gravity(doc["gravity_device"])
        return Capture(
            intrinsics=np.asarray(doc["intrinsics"], dtype=np.float64),
            world_from_camera=w_from_c,
            frames=frames,
            meta=doc.get("meta", {}),
        )
