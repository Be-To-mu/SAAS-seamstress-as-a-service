"""Anny body model wrapper with bounded shape parameters and a few posable joints.

Anny coordinates: metres, z up, the body faces -y, rest pose is an A-pose.
Pose rotations are axis-angle vectors about world-aligned axes at each joint.
"""

from __future__ import annotations

import functools
import json
from dataclasses import dataclass, field

import numpy as np
import roma
import torch

PHENOTYPES = ("gender", "age", "muscle", "weight", "height", "proportions")

# Joints the fitter may rotate; everything else stays in the rest A-pose.
POSE_BONES = (
    "spine03",
    "spine01",
    "neck01",
    "clavicle.L",
    "clavicle.R",
    "upperarm01.L",
    "upperarm01.R",
    "lowerarm01.L",
    "lowerarm01.R",
    "upperleg01.L",
    "upperleg01.R",
    "lowerleg01.L",
    "lowerleg01.R",
)

# Joints the measurement code uses as landmarks.
LANDMARK_BONES = (
    "neck01",
    "head",
    "spine01",
    "spine02",
    "spine03",
    "spine04",
    "spine05",
    "upperarm01.L",
    "upperarm01.R",
    "lowerarm01.L",
    "lowerarm01.R",
    "wrist.L",
    "wrist.R",
    "upperleg01.L",
    "upperleg01.R",
    "lowerleg01.L",
    "lowerleg01.R",
    "foot.L",
    "foot.R",
)


@functools.cache
def _age_anchors() -> tuple[np.ndarray, np.ndarray]:
    """Anny's calibrated mapping from age in years to its age parameter (WHO-based)."""
    from anny.paths import get_anny_root_dir

    d = torch.load(get_anny_root_dir() / "data/shape_calibration/girls.pth", weights_only=True)
    m = d["morphological_age_mapping"]
    return m["morphological_age_anchors"].numpy(), m["anny_age_anchors"].numpy()


def age_param(years: float) -> float:
    years_anchors, param_anchors = _age_anchors()
    return float(np.interp(years, years_anchors, param_anchors))


@functools.cache
def _load_anny():
    import anny

    return anny.Anny(local_changes="default").to(dtype=torch.float32)


@dataclass
class Shape:
    """Phenotypes in [0, 1] plus MakeHuman 'measure-*' local changes in [-1, 1]."""

    phenotypes: dict[str, float]
    changes: dict[str, float] = field(default_factory=dict)

    def to_json(self) -> str:
        return json.dumps({"phenotypes": self.phenotypes, "changes": self.changes}, indent=2)

    @staticmethod
    def from_json(text: str) -> Shape:
        d = json.loads(text)
        return Shape(d["phenotypes"], d.get("changes", {}))


class BodyModel:
    def __init__(self):
        self.anny = _load_anny()
        self.faces = self.anny.faces.detach().cpu().numpy()
        self.change_labels = [l for l in self.anny.local_change_labels if l.startswith("measure-")]
        labels = self.anny.bone_labels
        self.bone_count = self.anny.bone_count
        self.pose_bone_index = torch.tensor([labels.index(b) for b in POSE_BONES])
        self.landmark_index = {b: labels.index(b) for b in LANDMARK_BONES}

    def shape_tensors(self, shape: Shape) -> tuple[torch.Tensor, torch.Tensor]:
        ph = torch.tensor([[shape.phenotypes.get(k, 0.5) for k in PHENOTYPES]], dtype=torch.float32)
        ch = torch.tensor([[shape.changes.get(k, 0.0) for k in self.change_labels]], dtype=torch.float32)
        return ph, ch

    def shape_from_tensors(self, ph: torch.Tensor, ch: torch.Tensor) -> Shape:
        ph, ch = ph.detach().reshape(-1).tolist(), ch.detach().reshape(-1).tolist()
        return Shape(dict(zip(PHENOTYPES, ph)), dict(zip(self.change_labels, ch)))

    def forward(
        self, ph: torch.Tensor, ch: torch.Tensor, pose_rotvec: torch.Tensor | None = None
    ) -> dict[str, torch.Tensor]:
        """ph (B,6) in [0,1], ch (B,C) in [-1,1], pose_rotvec (B,len(POSE_BONES),3) or None.

        Returns posed `vertices` (B,V,3) and `joints` (B,J,3), plus the A-pose
        `rest_vertices` and `rest_joints`; joints follow `self.anny.bone_labels`.
        """
        b = ph.shape[0]
        rot = torch.eye(3, dtype=torch.float32).expand(b, self.bone_count, 3, 3)
        if pose_rotvec is not None:
            rot = rot.clone()
            rot[:, self.pose_bone_index] = roma.rotvec_to_rotmat(pose_rotvec)
        pose = torch.zeros(b, self.bone_count, 4, 4, dtype=torch.float32)
        pose[..., :3, :3] = rot
        pose[..., 3, 3] = 1.0
        out = self.anny(
            pose_parameters=pose,
            phenotype_kwargs={k: ph[:, i] for i, k in enumerate(PHENOTYPES)},
            local_changes_kwargs={k: ch[:, i] for i, k in enumerate(self.change_labels)},
        )
        return {
            "vertices": out["vertices"],
            "joints": out["bone_poses"][..., :3, 3],
            "rest_vertices": out["rest_vertices"],
            "rest_joints": out["rest_bone_heads"],
        }

    def landmarks(self, joints: torch.Tensor | np.ndarray) -> dict[str, np.ndarray]:
        j = joints.detach().cpu().numpy() if torch.is_tensor(joints) else joints
        j = j.reshape(-1, 3)
        return {name: j[i] for name, i in self.landmark_index.items()}

