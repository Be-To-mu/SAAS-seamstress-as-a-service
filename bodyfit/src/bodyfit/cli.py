"""bodyfit command line: usb | serve | fit | synth."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> None:
    ap = argparse.ArgumentParser(prog="bodyfit")
    sub = ap.add_subparsers(dest="cmd", required=True)

    u = sub.add_parser("usb", help="demo mode: fit scans from the plugged-in iPhone and send results back")
    u.add_argument("--device", help="device UDID (default: the first connected iPhone)")
    u.add_argument("--root", default="scans", help="where scans and results are kept")
    u.add_argument("--redo", action="store_true", help="fit every scan on the phone once more")

    s = sub.add_parser("serve", help="run the fitting service (network mode, for later)")
    s.add_argument("--host", default="0.0.0.0")
    s.add_argument("--port", type=int, default=8000)
    s.add_argument("--root", default="scans", help="where scans and results are kept")

    f = sub.add_parser("fit", help="fit a capture folder")
    f.add_argument("capture")
    f.add_argument("-o", "--out", default=None, help="output folder (default: <capture>/result)")
    f.add_argument("--age", type=float, help="age in years (overrides the capture's)")

    y = sub.add_parser("synth", help="render a synthetic scan of a random body")
    y.add_argument("out")
    y.add_argument("--seed", type=int, default=0)

    args = ap.parse_args()
    if args.cmd == "usb":
        from .usb import watch

        watch(args.device, args.root, redo=args.redo)
    elif args.cmd == "serve":
        from .server import serve

        serve(args.host, args.port, args.root)
    elif args.cmd == "fit":
        from .capture import Capture
        from .export import fit_scan

        if args.age is not None:
            doc_path = Path(args.capture) / "capture.json"
            doc = json.loads(doc_path.read_text())
            doc.setdefault("meta", {})["age_years"] = args.age
            doc_path.write_text(json.dumps(doc, indent=2))
        out = Path(args.out) if args.out else Path(args.capture) / "result"
        summary = fit_scan(Path(args.capture), out, verbose=True)
        for k, v in summary["measurements_cm"].items():
            print(f"{k:16s} {v if v is not None else '-':>7} cm")
        print(json.dumps(summary["fit"]))
    elif args.cmd == "synth":
        import numpy as np

        from .model import BodyModel
        from .synth import random_pose, random_shape, render_turn

        model = BodyModel()
        rng = np.random.default_rng(args.seed)
        shape, years = random_shape(model, rng)
        capture = render_turn(model, shape, random_pose(rng), seed=args.seed)
        capture.meta["age_years"] = years
        capture.save(args.out)
        print(f"wrote {args.out} ({len(capture.frames)} frames, age {years:.0f})")


if __name__ == "__main__":
    main()
