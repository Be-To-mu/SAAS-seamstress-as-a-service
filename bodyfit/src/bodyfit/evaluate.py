"""Synthetic recovery benchmark: render a known body, fit it, compare measurements."""

from __future__ import annotations

import numpy as np
import torch

from .fit import DETAIL, DetailStage, fit
from .measure import DEFINITIONS, measure
from .model import BodyModel
from .synth import SynthSettings, random_pose, random_shape, render_turn


def synthetic_trial(
    model: BodyModel,
    seed: int,
    settings: SynthSettings = SynthSettings(),
    detail: DetailStage | None = DETAIL,
    give_age: bool = False,  # the app doesn't ask for age
) -> dict:
    rng = np.random.default_rng(seed)
    shape, years = random_shape(model, rng)
    pose = random_pose(rng)
    capture = render_turn(model, shape, pose, settings, seed=seed)
    ph, ch = model.shape_tensors(shape)
    with torch.no_grad():
        truth = model.forward(ph, ch, torch.tensor(pose[None], dtype=torch.float32))
    # Like the app, compare on the standard A-pose body.
    true_m = measure(truth["rest_vertices"][0].numpy(), model.faces, model.landmarks(truth["rest_joints"][0]))
    result = fit(capture, model, seed=seed, detail=detail, age_years=years if give_age else None)
    est_m = measure(result.rest_vertices, model.faces, model.landmarks(result.rest_joints))
    t, e = true_m["measurements_cm"], est_m["measurements_cm"]
    return {
        "seed": seed,
        "age_years": round(years, 1),
        "truth_cm": t,
        "estimate_cm": e,
        "error_cm": {k: round(e[k] - t[k], 1) for k in DEFINITIONS if e[k] is not None and t[k] is not None},
        "residual_mm": round(result.residual_mm, 2),
        "seconds": round(result.seconds, 1),
        "timings": result.timings,
    }


def summarise(trials: list[dict]) -> dict[str, dict[str, float]]:
    """Per measurement: mean (bias) and max absolute error over trials, in cm."""
    out = {}
    for k in DEFINITIONS:
        errs = np.array([t["error_cm"][k] for t in trials if k in t["error_cm"]])
        if len(errs):
            out[k] = {"bias": round(float(errs.mean()), 2), "max_abs": round(float(np.abs(errs).max()), 2)}
    return out
