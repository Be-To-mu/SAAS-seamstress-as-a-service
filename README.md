# SAAS: Seamstress As A Service

Design one-off clothing on a 3D model of your own body, turn the design into sewing patterns, and have it made by a seamstress.

**Milestone 1:** body → 3D model + sewing measurements. **Milestone 2:** those measurements → a sewable 2D pattern.

- `ios/`: iPhone app (LiDAR iPhone, iOS 26). It records a 20 s turn scan and sends it to the fitting service. Then it shows the fitted body and a measurement sheet.
- `bodyfit/`: Python package. It fits the [Anny](https://github.com/naver/anny) body model to the scan, then measures it. Anny is Apache-2.0 with CC0 assets, so it's fine for commercial use.
- `web/`: Next.js studio. Type in (or paste) the measurements, design a coat, knit top or skirt from photos and words, and download a 1:1 PDF pattern. See [`web/README.md`](web/README.md).
- `docs/capture-format.md`: what the phone sends.

## Run it (demo: phone plugged into the Mac)

```sh
python3 -m venv .venv && .venv/bin/pip install -e "bodyfit[dev,server]"
.venv/bin/bodyfit usb              # watches the plugged-in iPhone for new scans
```

```sh
cd ios
cp Local.xcconfig.example Local.xcconfig   # your team ID
xcodegen
open Seamstress.xcodeproj                  # or build/install with xcodebuild + devicectl
```

The app opens on the camera. Prop the phone upright at waist height, leave it plugged into the Mac, and follow the spoken instructions. Then turn slowly to your left for 20 seconds. `bodyfit usb` copies the scan over the cable with Xcode's `devicectl`, fits it, and copies the 3D body and measurements back into the app. No network is needed. Results are also kept in `scans/<scan>/result/`.

Other commands:

```sh
bodyfit fit <capture-folder>        # fit a saved scan
bodyfit synth out/ --seed 3         # synthetic scan of a random body, for testing
bodyfit serve                       # network mode (HTTP), for a hosted version later
.venv/bin/pytest bodyfit/tests
```

## How the fit works

1. **Cut out the person:** Apple's person mask from the phone. Without one, the depth-continuous region above the floor in the middle of the picture (`segment.py`).
2. **Turn angle per frame:** from Vision's 3D body pose, checked against the depth (`turn.py`).
3. **Fit the body model** (`fit.py`): one Anny shape and pose for the whole scan, plus a rigid transform per frame, using point-to-triangle ICP. Adam then L-BFGS. Anny's age parameter is pinned to a typical adult value (it barely changes between 18 and 64). Left free, the fit ends up about 1 cm too big.
4. **Add detail:** a smooth per-vertex displacement captures what Anny's shape space can't.
5. **Measure** (`measure.py`): ISO 8559-1-style girths and lengths, found from slices and skeleton landmarks.

On synthetic scans with realistic LiDAR noise, torso and leg girths come out within about ±0.7 cm. Wrist and arm length are worse, because the arms move during the turn.

## Voice prompts

The scan instructions are spoken, because the person can't see the screen. The clips are made with ElevenLabs and bundled in the app (`ios/Seamstress/Voice/*.mp3`). If a clip is missing, the app uses the system voice. To change the wording or the voice, edit `tools/voice/prompts.json`, put `ELEVENLABS_API_KEY=…` (and optionally `ELEVENLABS_VOICE_ID=…`) in `.env`, then run:

```sh
.venv/bin/python tools/voice/generate.py
```

Keep the text in `VoicePrompter.Prompt` in step with `prompts.json`; the app uses it for the fallback voice.
