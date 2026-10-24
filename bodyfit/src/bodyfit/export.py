"""Fit a capture folder and write the results a person (or the app) needs."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .capture import Capture
from .fit import fit
from .measure import DEFINITIONS, MeasureError, measure
from .model import BodyModel


def write_obj(path: Path, vertices: np.ndarray, faces: np.ndarray) -> None:
    """OBJ in y-up convention (most viewers, SceneKit); Anny is z-up."""
    v = y_up(vertices)
    lines = [f"v {x:.5f} {y:.5f} {z:.5f}" for x, y, z in v]
    lines += [f"f {a + 1} {b + 1} {c + 1}" for a, b, c in faces]
    path.write_text("\n".join(lines) + "\n")


def y_up(points) -> np.ndarray:
    p = np.asarray(points, dtype=float).reshape(-1, 3)
    return p[:, [0, 2, 1]] * [1, 1, -1]


def fit_scan(capture_dir: Path, out: Path, verbose: bool = False, progress=None, warm: dict | None = None) -> dict:
    """Fit a capture. The body is shown and measured in the standard A-pose.

    `progress(step)` gets "prepare", "align", "shape", "polish", "detail", "measure".
    `warm` ({"shape", "pose_rotvec"} from an earlier fit of the same person) is the start point.
    """
    capture = Capture.load(capture_dir)
    model = BodyModel()
    age = capture.meta.get("age_years")
    result = fit(capture, model, age_years=age, verbose=verbose, progress=progress, warm=warm)

    # Save the body before measuring, so a measuring problem still leaves a body to look at.
    out.mkdir(parents=True, exist_ok=True)
    write_obj(out / "body.obj", result.rest_vertices, model.faces)  # standard A-pose
    write_obj(out / "scanned.obj", result.posed_vertices, model.faces)  # as stood, for debugging
    (out / "shape.json").write_text(result.shape.to_json())
    np.savez(out / "fit.npz", yaw=result.yaw, translation=result.translation, frames=result.frames_used,
             pose=result.pose_rotvec, rest_joints=result.rest_joints, rest_vertices=result.rest_vertices)
    if progress:
        progress("measure")
    try:
        m = measure(result.rest_vertices, model.faces, model.landmarks(result.rest_joints))
        m["tapes"] = {k: [y_up(t).round(4).tolist() for t in v] for k, v in m["tapes"].items()}
        m["lines"] = {k: y_up(v).round(4).tolist() for k, v in m["lines"].items()}
    except MeasureError as e:
        m = {"measurements_cm": {k: None for k in DEFINITIONS}, "measure_error": str(e), "tapes": {}, "lines": {}}
    summary = {
        **m,
        "definitions": DEFINITIONS,
        "order": list(DEFINITIONS),
        "fit": {
            "residual_mm": round(result.residual_mm, 2),
            "seconds": round(result.seconds, 1),
            "timings_s": result.timings,
            "frames_used": len(result.frames_used),
            "frames_total": len(capture.frames),
            "turn_deg": round(float(np.degrees(result.yaw[-1] - result.yaw[0])), 1),
            "age_years": age,
        },
    }
    (out / "measurements.json").write_text(json.dumps(summary, indent=2))
    return summary
