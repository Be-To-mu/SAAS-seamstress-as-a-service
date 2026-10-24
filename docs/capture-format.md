# Capture bundle format (v1)

One turn scan = one folder. The iPhone app writes it, zips it, and POSTs it to `bodyfit serve`.
`bodyfit/src/bodyfit/capture.py` reads it.

```
capture.json
depth/0000.png …   16-bit grayscale PNG, depth in millimetres, 0 = no reading
rgb/0000.jpg …     colour frame (half resolution), not used by the fit yet
mask/0000.png …    optional 8-bit person mask; absent from phone scans
```

## capture.json

| key | meaning |
|---|---|
| `version` | `1` |
| `depth_size` | `[width, height]` of the depth maps |
| `intrinsics` | 3×3 camera matrix scaled to the depth resolution (OpenCV convention, pixel centres on integers) |
| `world_from_camera` | optional 3×3 rotation from camera axes (x right, y down, z forward) to world (z up). Synthetic scans include it. |
| `gravity_device` | phone scans only: mean `CMDeviceMotion.gravity` (device axes) while recording. Used to build `world_from_camera` when that key is absent. The depth maps are in the back camera's native landscape orientation. |
| `frames[]` | per keyframe (about 4 per second): `depth`, `mask` (path or null), `yaw_hint` (radians or null), `time` (s), and from the phone also `rgb`, `gravity_device` and `vision` |
| `frames[].vision` | raw `VNHumanBodyPose3DObservation`: `camera_origin_matrix_columns` (4×4, column-major), `left_hip`, `right_hip` (root-relative, metres), `body_height` |
| `meta.age_years` | age the user entered. Pins Anny's age parameter. |

## What bodyfit derives

- **Person mask** (`segment.py`): everything above the floor and within 60 cm of where the person stands.
- **Turn angle per frame** (`turn.py`): from the Vision hip axis. All 8 axis-sign conventions are tried, and the one that best matches the depth wins. If there is no Vision data, the angles come from depth alone, scored against an average body with a Viterbi turn sequence.

Scanning protocol, as the app speaks it:

1. Phone upright at waist height, person about 2 m away.
2. Tight clothing, arms slightly out from the body.
3. Start facing the phone, then turn slowly to the left, one full turn, over 30 s.
