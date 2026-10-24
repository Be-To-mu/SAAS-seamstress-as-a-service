"""Demo mode: fit scans straight off a plugged-in iPhone with `bodyfit usb`.

The Mac does all the moving, through Xcode's `devicectl`:

1. It watches the Seamstress app's Documents/scans for scans without a result.
2. It copies capture.json + depth/ (+ mask/) over and fits them.
3. It copies body.obj, measurements.json and status.json back into the scan folder.

The app just watches its own folder. No network needed.
"""

from __future__ import annotations

import json
import os

import numpy as np
import subprocess
import tempfile
import time
import traceback
from pathlib import Path

from .export import fit_scan

APP = "io.github.be-to-mu.Seamstress"
# What the phone shows for each fit phase, and how far along that is.
STEPS = {
    "copy": ("Copying your scan to the Mac", 0.05),
    "prepare": ("Finding you in the scan", 0.15),
    "align": ("Fitting your shape", 0.3),
    "shape": ("Fitting your shape", 0.5),
    "polish": ("Fitting your shape", 0.7),
    "detail": ("Adding detail", 0.8),
    "measure": ("Measuring", 0.95),
}
SCANS = "Documents/scans"
XCODE = "/Applications/Xcode.app/Contents/Developer"


class Device:
    def __init__(self, udid: str | None = None):
        self.env = {**os.environ, "DEVELOPER_DIR": os.environ.get("DEVELOPER_DIR", XCODE)}
        self.udid = udid or self._first_iphone()

    def _devicectl(self, *args: str, json_out: bool = False) -> dict | None:
        with tempfile.NamedTemporaryFile(suffix=".json") as out:
            cmd = ["xcrun", "devicectl", *args] + (["--json-output", out.name] if json_out else [])
            proc = subprocess.run(cmd, env=self.env, capture_output=True, text=True)
            if proc.returncode != 0:
                raise RuntimeError(f"devicectl {args[0]} {args[1]} failed: {proc.stderr.strip()[-300:]}")
            return json.loads(Path(out.name).read_text()) if json_out else None

    def _first_iphone(self) -> str:
        doc = self._devicectl("list", "devices", json_out=True)
        for d in doc["result"]["devices"]:
            hw = d["hardwareProperties"]
            if hw.get("reality") == "physical" and d.get("connectionProperties", {}).get("tunnelState") == "connected":
                return hw["udid"]
        raise RuntimeError("no iPhone connected; plug it in and unlock it")

    def _app_args(self) -> list[str]:
        return ["--device", self.udid, "--domain-type", "appDataContainer", "--domain-identifier", APP]

    def list_files(self, sub: str = SCANS) -> list[str]:
        doc = self._devicectl("device", "info", "files", *self._app_args(), "--subdirectory", sub, json_out=True)
        return [f["relativePath"] for f in doc["result"]["files"]]

    def pull(self, remote: str, local: Path) -> None:
        local.parent.mkdir(parents=True, exist_ok=True)
        self._devicectl("device", "copy", "from", *self._app_args(), "--source", remote, "--destination", str(local))

    def push(self, local: Path, remote: str) -> None:
        self._devicectl("device", "copy", "to", *self._app_args(), "--source", str(local), "--destination", remote)

    def push_into(self, files: list[Path], remote_dir: str) -> None:
        """Several files into one folder on the phone, in a single call."""
        sources = [a for f in files for a in ("--source", str(f))]
        self._devicectl("device", "copy", "to", *self._app_args(), *sources, "--destination", remote_dir)


def pending_scans(files: list[str]) -> list[str]:
    """The newest scan, if it has no result yet. The phone keeps one body; older scans are ignored."""
    have = set(files)
    scans = sorted({p.split("/")[0] for p in files if p.endswith("/capture.json")})
    return [scans[-1]] if scans and f"{scans[-1]}/measurements.json" not in have else []


def previous_fit(root: Path, scan: str) -> dict | None:
    """Shape and pose of the last body fitted before `scan`, to start the new fit from."""
    for folder in sorted(root.glob("*/result/fit.npz"), reverse=True):
        name = folder.parent.parent.name
        if name >= scan:
            continue
        shape = json.loads((folder.parent / "shape.json").read_text())
        return {"shape": shape, "pose_rotvec": np.load(folder)["pose"].tolist()}
    return None


def process(device: Device, scan: str, root: Path) -> dict:
    remote = f"{SCANS}/{scan}"
    local = root / scan
    capture = local / "capture"

    def status(state: str, **extra) -> None:
        path = local / "status.json"
        path.write_text(json.dumps({"state": state, **extra}))
        device.push(path, f"{remote}/status.json")

    def step(name: str) -> None:
        if name in ("prepare", "detail"):  # two progress updates keep cable time down
            text, fraction = STEPS[name]
            status("fitting", step=text, progress=fraction)

    local.mkdir(parents=True, exist_ok=True)
    files = device.list_files(remote)
    device.pull(f"{remote}/capture.json", capture / "capture.json")
    for sub in ("depth", "mask"):  # the colour photos stay on the phone
        if sub in files:
            device.pull(f"{remote}/{sub}", capture / sub)
    try:
        # No warm start from earlier scans: a bad earlier scan pulled real fits to a different body.
        summary = fit_scan(capture, local / "result", progress=step)
    except Exception as e:
        traceback.print_exc()
        status("failed", error=f"{type(e).__name__}: {e}")
        raise
    (local / "result" / "status.json").write_text(json.dumps({"state": "done"}))
    device.push_into([local / "result" / n for n in ("body.obj", "measurements.json", "status.json")], remote)
    return summary


def watch(udid: str | None = None, root: str = "scans", interval: float = 2.0, redo: bool = False) -> None:
    """`redo`: fit every scan on the phone once more (e.g. after improving the fit)."""
    device = Device(udid)
    root_path = Path(root)
    print(f"Watching the Seamstress app on {device.udid} for new scans (Ctrl-C to stop)")
    failed: set[str] = set()
    again: set[str] | None = None
    while True:
        try:
            files = device.list_files()
            if redo and again is None:  # just the current (newest) scan
                again = set(sorted({p.split("/")[0] for p in files if p.endswith("/capture.json")})[-1:])
            todo = sorted(set(pending_scans(files)) | (again or set()))
            todo = [s for s in todo if s not in failed]
        except RuntimeError as e:
            print(f"  {e}; retrying")
            time.sleep(5)
            continue
        for scan in todo:
            if again:
                again.discard(scan)
            print(f"{scan}: fitting…", flush=True)
            t = time.time()
            try:
                summary = process(device, scan, root_path)
            except Exception as e:
                failed.add(scan)
                print(f"{scan}: failed ({e})")
                continue
            m = summary["measurements_cm"]
            print(f"{scan}: done in {time.time() - t:.0f} s: height {m['height']} cm, "
                  f"chest {m['bust']}, waist {m['waist']}, hip {m['hip']}")
            print(f"    fit phases (s): {summary['fit']['timings_s']}", flush=True)
        time.sleep(interval)
