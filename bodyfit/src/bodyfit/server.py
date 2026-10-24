"""Fitting service for the iPhone app: `bodyfit serve`.

POST /scans            body = zipped capture folder → {"id"}
GET  /scans/{id}       → state (queued | fitting | done | failed), measurements
GET  /scans/{id}/body.obj   fitted body as scanned (y up, metres)
GET  /scans/{id}/apose.obj  fitted body in the A-pose, for designing on

Fits run one at a time in a background thread; scans are kept in `scans/`.
"""

from __future__ import annotations

import io
import json
import queue
import threading
import traceback
import uuid
import zipfile
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse

from .export import fit_scan

ROOT = Path("scans")
app = FastAPI(title="bodyfit")
jobs: queue.Queue[str] = queue.Queue()


def _state_path(scan_id: str) -> Path:
    return ROOT / scan_id / "state.json"


def _set_state(scan_id: str, **state) -> None:
    _state_path(scan_id).write_text(json.dumps(state))


@app.post("/scans")
async def create_scan(request: Request):
    data = await request.body()
    scan_id = uuid.uuid4().hex[:12]
    folder = ROOT / scan_id / "capture"
    folder.mkdir(parents=True)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        z.extractall(folder)
    # The phone zips the scan folder itself, so capture.json may sit one level down.
    found = next(folder.rglob("capture.json"), None)
    if found is None:
        raise HTTPException(400, "zip has no capture.json")
    (ROOT / scan_id / "capture_path").write_text(str(found.parent))
    _set_state(scan_id, state="queued")
    jobs.put(scan_id)
    return {"id": scan_id}


@app.get("/scans/{scan_id}")
def get_scan(scan_id: str):
    path = _state_path(scan_id)
    if not path.exists():
        raise HTTPException(404, "unknown scan")
    state = json.loads(path.read_text())
    result = ROOT / scan_id / "result" / "measurements.json"
    if state["state"] == "done" and result.exists():
        state.update(json.loads(result.read_text()))
    return state


@app.get("/scans/{scan_id}/{name}")
def get_mesh(scan_id: str, name: str):
    if name not in ("body.obj", "apose.obj"):
        raise HTTPException(404)
    path = ROOT / scan_id / "result" / name
    if not path.exists():
        raise HTTPException(404, "not fitted yet")
    return FileResponse(path, media_type="text/plain")


def _worker() -> None:
    while True:
        scan_id = jobs.get()
        try:
            _set_state(scan_id, state="fitting")
            capture = Path((ROOT / scan_id / "capture_path").read_text())
            fit_scan(capture, ROOT / scan_id / "result")
            _set_state(scan_id, state="done")
        except Exception as e:  # report to the app instead of dying
            traceback.print_exc()
            _set_state(scan_id, state="failed", error=f"{type(e).__name__}: {e}")


def serve(host: str = "0.0.0.0", port: int = 8000, root: str = "scans") -> None:
    import uvicorn

    global ROOT
    ROOT = Path(root)
    ROOT.mkdir(parents=True, exist_ok=True)
    for state in ROOT.glob("*/state.json"):  # resume fits interrupted by a restart
        if json.loads(state.read_text())["state"] in ("queued", "fitting"):
            jobs.put(state.parent.name)
    threading.Thread(target=_worker, daemon=True).start()
    uvicorn.run(app, host=host, port=port)
