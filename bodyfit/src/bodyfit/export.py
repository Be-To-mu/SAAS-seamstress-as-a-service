"""Fit a capture folder and write the results a person (or the app) needs."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .capture import Capture
from .fit import fit
from .measure import DEFINITIONS, measure
from .model import BodyModel


def write_obj(path: Path, vertices: np.ndarray, faces: np.ndarray) -> None:
    """OBJ in y-up convention (most viewers, SceneKit); Anny is z-up."""
    v = vertices[:, [0, 2, 1]] * [1, 1, -1]
    lines = [f"v {x:.5f} {y:.5f} {z:.5f}" for x, y, z in v]
    lines += [f"f {a + 1} {b + 1} {c + 1}" for a, b, c in faces]
    path.write_text("\n".join(lines) + "\n")


def fit_scan(capture_dir: Path, out: Path, verbose: bool = False) -> dict:
    capture = Capture.load(capture_dir)
    model = BodyModel()
    age = capture.meta.get("age_years")
    result = fit(capture, model, age_years=age, verbose=verbose)
    m = measure(result.posed_vertices, model.faces, model.landmarks(result.posed_joints))

    out.mkdir(parents=True, exist_ok=True)
    write_obj(out / "body.obj", result.posed_vertices, model.faces)
    write_obj(out / "apose.obj", result.rest_vertices, model.faces)
    (out / "shape.json").write_text(result.shape.to_json())
    summary = {
        **m,
        "definitions": DEFINITIONS,
        "order": list(DEFINITIONS),
        "fit": {
            "residual_mm": round(result.residual_mm, 2),
            "seconds": round(result.seconds, 1),
            "frames_used": len(result.frames_used),
            "frames_total": len(capture.frames),
            "turn_deg": round(float(np.degrees(result.yaw[-1] - result.yaw[0])), 1),
            "age_years": age,
        },
    }
    (out / "measurements.json").write_text(json.dumps(summary, indent=2))
    return summary
