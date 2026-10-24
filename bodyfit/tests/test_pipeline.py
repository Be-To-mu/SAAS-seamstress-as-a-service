import json

import numpy as np
import pytest
import torch

from bodyfit.capture import Capture, world_from_gravity
from bodyfit.evaluate import synthetic_trial
from bodyfit.measure import measure
from bodyfit.model import PHENOTYPES, BodyModel, Shape
from bodyfit.synth import SynthSettings, random_pose, random_shape, render_turn


@pytest.fixture(scope="module")
def model():
    return BodyModel()


def test_level_phone_gravity_gives_synthetic_axes():
    # Portrait, upright, level: gravity is -y in device axes.
    w = world_from_gravity([0, -1, 0])
    up_in_camera = w[2]
    assert np.allclose(up_in_camera, [-1, 0, 0])  # scene up is the landscape buffer's left
    assert np.allclose(w[1], [0, 0, 1])  # forward stays forward


def test_measurements_respond_to_shape(model):
    base = Shape({k: 0.5 for k in PHENOTYPES})
    wider = Shape(base.phenotypes, {"measure-waist-circ-incr": 1.0})
    out = []
    for s in (base, wider):
        with torch.no_grad():
            o = model.forward(*model.shape_tensors(s))
        out.append(measure(o["vertices"][0].numpy(), model.faces, model.landmarks(o["joints"][0]))["measurements_cm"])
    assert out[1]["waist"] > out[0]["waist"] + 3
    assert abs(out[1]["height"] - out[0]["height"]) < 0.5


def test_capture_roundtrip_without_masks(tmp_path, model):
    rng = np.random.default_rng(0)
    shape, _ = random_shape(model, rng)
    cap = render_turn(model, shape, random_pose(rng), SynthSettings(n_frames=4), seed=0)
    cap.save(tmp_path)
    back = Capture.load(tmp_path)
    assert len(back.frames) == 4 and back.frames[0].mask is None
    assert np.abs(back.frames[0].depth - cap.frames[0].depth).max() < 0.001


def test_one_body_recovered(model):
    """MVP check: one synthetic body comes back with girths within about 1 cm."""
    trial = synthetic_trial(model, seed=4)
    err = trial["error_cm"]
    for key in ("bust", "waist", "hip", "thigh", "height"):
        assert abs(err[key]) <= 1.0, json.dumps(trial)
