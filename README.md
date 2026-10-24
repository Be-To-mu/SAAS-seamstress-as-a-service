# SAAS: Seamstress As A Service

Design one-off clothing on a 3D model of your own body, turn the design into sewing patterns, and have it made by a seamstress.

**Milestone 1 (this repo now): body → 3D model + sewing measurements.**

- `ios/`: iPhone app (LiDAR iPhone, iOS 26). It records a 30 s turn scan and sends it to the fitting service. Then it shows the fitted body and a measurement sheet.
- `bodyfit/`: Python package. It fits the [Anny](https://github.com/naver/anny) body model to the scan, then measures it. Anny is Apache-2.0 with CC0 assets, so it's fine for commercial use.
- `docs/capture-format.md`: what the phone sends.

## Run it

```sh
python3 -m venv .venv && .venv/bin/pip install -e "bodyfit[dev,server]"
.venv/bin/bodyfit serve            # on the Mac, port 8000
```

```sh
cd ios
cp Local.xcconfig.example Local.xcconfig   # team ID + the Mac's LAN address
xcodegen
open Seamstress.xcodeproj                  # or build/install with xcodebuild + devicectl
```

In the app, enter your age and tap **New body scan**. Prop the phone upright at waist height, follow the spoken instructions, and turn slowly to your left once. The result appears after about 2 minutes. Meshes and measurements are also written to `scans/<id>/result/`.

Other commands:

```sh
bodyfit fit <capture-folder>        # fit a saved scan (e.g. copied off the phone via Files)
bodyfit synth out/ --seed 3         # synthetic scan of a random body, for testing
.venv/bin/pytest bodyfit/tests
```

## How the fit works

1. **Cut out the person:** everything above the floor near where they stand (`segment.py`).
2. **Turn angle per frame:** from Vision's 3D body pose, checked against the depth (`turn.py`).
3. **Fit the body model** (`fit.py`): one Anny shape and pose for the whole scan, plus a rigid transform per frame, using point-to-triangle ICP. Adam then L-BFGS. The age you enter pins Anny's age parameter. Without it the fit ends up about 1 cm too big.
4. **Add detail:** a smooth per-vertex displacement captures what Anny's shape space can't.
5. **Measure** (`measure.py`): ISO 8559-1-style girths and lengths, found from slices and skeleton landmarks.

On synthetic scans with realistic LiDAR noise, torso and leg girths come out within about ±0.7 cm. Wrist and arm length are worse, because the arms move during the turn.
