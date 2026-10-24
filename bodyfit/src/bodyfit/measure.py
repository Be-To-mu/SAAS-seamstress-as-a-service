"""Sewing measurements on a fitted body mesh, following ISO 8559-1 definitions.

Measure the body in its as-scanned posture (FitResult.posed_vertices/joints):
that surface is what the scan observed, and tape measurements are taken on a
person standing upright too. The arms must hang clear of the torso (A-pose).

Landmarks are found geometrically (plane slices + skeleton joints), not from
fixed vertex lists, so they work on any body shape. Girths use the convex hull
of the slice, which is what a tape measure pulled snug around the body reads.

Coordinates: metres, z up, the body faces -y. Output: centimetres.
"""

from __future__ import annotations

import numpy as np
import trimesh
from scipy.spatial import ConvexHull

STEP = 0.0025  # slice spacing when searching for a landmark height, metres
LEVEL_TOL = 0.003  # girths within this of the extreme count as "at" the landmark

# name → human description, in the order the measurement sheet shows them
DEFINITIONS = {
    "height": "Stature, floor to top of head",
    "neck": "Neck girth, perpendicular to the neck halfway up",
    "shoulder_width": "Shoulder breadth, acromion to acromion",
    "bust": "Bust/chest girth, fullest level below the armpits",
    "underbust": "Underbust girth, narrowest level just below the bust",
    "waist": "Waist girth, natural (narrowest) waist",
    "high_hip": "High hip girth, halfway between waist and hip",
    "hip": "Hip girth, fullest level of the seat",
    "upper_arm": "Upper arm girth, halfway shoulder to elbow (mean L/R)",
    "wrist": "Wrist girth (mean L/R)",
    "thigh": "Thigh girth, just below the crotch (mean L/R)",
    "knee": "Knee girth at the knee joint (mean L/R)",
    "calf": "Calf girth, fullest level (mean L/R)",
    "arm_length": "Arm length, acromion via elbow to wrist (mean L/R)",
    "back_length": "Back length, nape to waist",
    "rise": "Body rise, waist to crotch",
    "inseam": "Inside leg, crotch to floor",
    "outseam": "Outside leg, waist to floor",
}


class Slicer:
    def __init__(self, vertices: np.ndarray, faces: np.ndarray):
        self.mesh = trimesh.Trimesh(vertices, faces, process=False)

    def loops(self, origin, normal) -> tuple[list[np.ndarray], np.ndarray]:
        """Closed slice polylines as 2D arrays in a basis of the plane centred on `origin`."""
        normal = np.asarray(normal, float) / np.linalg.norm(normal)
        basis = _plane_basis(normal)
        section = self.mesh.section(plane_origin=origin, plane_normal=normal)
        if section is None:
            return [], basis
        out = []
        for poly in section.discrete:
            if len(poly) >= 4:
                out.append((poly - origin) @ basis.T)
        return out, basis

    def loop_around(self, origin, normal, point=None) -> np.ndarray | None:
        """The smallest slice loop that encloses `point` (default: the plane origin)."""
        loops, basis = self.loops(origin, normal)
        p = np.zeros(2) if point is None else (np.asarray(point) - origin) @ basis.T
        inside = [l for l in loops if _contains(l, p)]
        if not inside:
            return None
        return min(inside, key=_area)

    def girth(self, origin, normal, point=None) -> float | None:
        loop = self.loop_around(origin, normal, point)
        return None if loop is None else hull_perimeter(loop)


def measure(vertices: np.ndarray, faces: np.ndarray, joints: dict[str, np.ndarray]) -> dict:
    """Measurements in cm; `joints` from BodyModel.landmarks()."""
    s = Slicer(vertices, faces)
    j = joints
    up = np.array([0.0, 0.0, 1.0])
    floor, top = vertices[:, 2].min(), vertices[:, 2].max()

    axis = _torso_axis(j)

    def torso(z):
        p = np.array([*axis(z), z])
        return s.girth(p, up)

    def scan(z0, z1, fn, pick):
        zs = np.arange(z0, z1, STEP)
        vals = [(z, fn(z)) for z in zs]
        vals = [(z, g) for z, g in vals if g is not None]
        if not vals:
            raise MeasureError(f"no slice found in [{z0:.3f}, {z1:.3f}]")
        # Girth profiles are flat near the extreme; take the middle of the
        # near-extreme band so the level doesn't jump between similar bodies.
        best = pick(g for _, g in vals)
        near = [z for z, g in vals if abs(g - best) < LEVEL_TOL]
        z = float(np.median(near))
        g = fn(z)
        return z, best if g is None else g

    knee_z = 0.5 * (j["lowerleg01.L"][2] + j["lowerleg01.R"][2])
    hip_joint_z = 0.5 * (j["upperleg01.L"][2] + j["upperleg01.R"][2])
    shoulder_z = 0.5 * (j["upperarm01.L"][2] + j["upperarm01.R"][2])

    crotch_z = _first(np.arange(knee_z, hip_joint_z + 0.1, STEP), lambda z: torso(z) is not None)
    armpit_z = _first(np.arange(shoulder_z, crotch_z, -STEP), lambda z: _arms_free(s, axis, z))
    torso_len = shoulder_z - crotch_z

    bust_z, bust = scan(armpit_z - 0.25 * torso_len, armpit_z - 0.01, torso, max)
    under_z, underbust = scan(bust_z - 0.2 * torso_len, bust_z - 0.03, torso, min)
    waist_z, waist = scan(crotch_z + 0.3 * torso_len, under_z - 0.02, torso, min)
    hip_z, hip = scan(crotch_z + 0.03, waist_z - 0.06, torso, max)
    high_hip = torso(0.5 * (waist_z + hip_z))

    neck_mid = 0.5 * (j["neck01"] + j["head"])
    neck = s.girth(neck_mid, j["head"] - j["neck01"])

    acromion = {side: _acromion(vertices, j[f"upperarm01.{side}"]) for side in "LR"}
    limbs = {}
    for side in "LR":
        sh, el, wr = j[f"upperarm01.{side}"], j[f"lowerarm01.{side}"], j[f"wrist.{side}"]
        hipj, kn, an = j[f"upperleg01.{side}"], j[f"lowerleg01.{side}"], j[f"foot.{side}"]

        def leg(z, a=hipj, b=kn):
            return s.girth(np.array([*_lerp_z(a, b, z), z]), up)

        _, calf = scan(kn[2] - 0.6 * (kn[2] - an[2]), kn[2] - 0.1 * (kn[2] - an[2]),
                       lambda z: leg(z, kn, an), max)
        limbs[side] = {
            "upper_arm": s.girth(sh + 0.5 * (el - sh), el - sh),
            "wrist": s.girth(el + 0.95 * (wr - el), wr - el),
            "thigh": leg(crotch_z - 0.025),
            "knee": leg(kn[2], kn, an),
            "calf": calf,
            "arm_length": np.linalg.norm(acromion[side] - el) + np.linalg.norm(el - wr),
        }

    nape_z = _nape_z(vertices, j["neck01"])
    m = {
        "height": top - floor,
        "neck": neck,
        "shoulder_width": abs(acromion["L"][0] - acromion["R"][0]),
        "bust": bust,
        "underbust": underbust,
        "waist": waist,
        "high_hip": high_hip,
        "hip": hip,
        "back_length": nape_z - waist_z,
        "rise": waist_z - crotch_z,
        "inseam": crotch_z - floor,
        "outseam": waist_z - floor,
    }
    for key in ("upper_arm", "wrist", "thigh", "knee", "calf", "arm_length"):
        vals = [limbs[side][key] for side in "LR" if limbs[side][key] is not None]
        m[key] = float(np.mean(vals)) if vals else None
    cm = {k: (None if m[k] is None else round(float(m[k]) * 100, 1)) for k in DEFINITIONS}
    levels = {"crotch": crotch_z, "armpit": armpit_z, "bust": bust_z, "underbust": under_z,
              "waist": waist_z, "hip": hip_z}
    return {"measurements_cm": cm,
            "levels_cm_above_floor": {k: round(float(z - floor) * 100, 1) for k, z in levels.items()}}


class MeasureError(RuntimeError):
    pass


def hull_perimeter(points2: np.ndarray) -> float:
    return float(ConvexHull(points2).area)  # in 2D, .area is the perimeter


def _arms_free(s: Slicer, axis, z) -> bool:
    """Below the armpits a horizontal slice shows the torso and two separate arms."""
    loops, _ = s.loops(np.array([0.0, 0.0, z]), [0, 0, 1])
    big = [l for l in loops if hull_perimeter(l) > 0.08]
    return len(big) >= 3 and any(_contains(l, np.asarray(axis(z))) for l in big)


def _torso_axis(j):
    names = ["spine05", "spine04", "spine03", "spine02", "spine01", "neck01", "head"]
    pts = [0.5 * (j["upperleg01.L"] + j["upperleg01.R"])] + [j[n] for n in names]
    pts = np.array(sorted(pts, key=lambda p: p[2]))

    def at(z):
        return np.array([np.interp(z, pts[:, 2], pts[:, 0]), np.interp(z, pts[:, 2], pts[:, 1])])

    return at


def _lerp_z(a, b, z):
    t = (z - a[2]) / (b[2] - a[2])
    return (a + t * (b - a))[:2]


def _acromion(vertices, shoulder_joint):
    d = np.linalg.norm(vertices[:, :2] - shoulder_joint[:2], axis=1)
    near = vertices[(d < 0.04) & (vertices[:, 2] > shoulder_joint[2])]
    return near[np.argmax(near[:, 2])]


def _nape_z(vertices, neck_base):
    near = vertices[(np.abs(vertices[:, 0]) < 0.02) & (np.abs(vertices[:, 2] - neck_base[2]) < 0.03)]
    back = near[np.argmax(near[:, 1])] if len(near) else neck_base
    return back[2]


def _first(zs, pred):
    for z in zs:
        if pred(z):
            return float(z)
    raise MeasureError("landmark not found")


def _plane_basis(n):
    a = np.array([1.0, 0, 0]) if abs(n[0]) < 0.9 else np.array([0, 1.0, 0])
    e1 = np.cross(n, a)
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(n, e1)
    if abs(n[2]) > 0.99:  # horizontal slice: use plain x, y
        e1, e2 = np.array([1.0, 0, 0]), np.array([0, 1.0, 0])
    return np.stack([e1, e2])


def _area(poly):
    x, y = poly[:, 0], poly[:, 1]
    return 0.5 * abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1)))


def _contains(poly, p):
    x, y = poly[:, 0], poly[:, 1]
    x2, y2 = np.roll(x, -1), np.roll(y, -1)
    cross = (y > p[1]) != (y2 > p[1])
    with np.errstate(divide="ignore", invalid="ignore"):
        xi = x + (p[1] - y) * (x2 - x) / (y2 - y)
    return bool(np.sum(cross & (p[0] < xi)) % 2)
