"""The wardrobe in MongoDB, synced with the phone over USB by `bodyfit usb`.

The phone keeps garments in Documents/garments/<id>/ (garment.json, views/<angle>.jpg,
tryon.jpg). The phone can't reach MongoDB itself, so the Mac does it:

- up:   a phone garment without synced.json is upserted into `garments` (same
        database as the web studio, _id = the phone's id) and its pictures go to
        `garment_views`, one document per image. Then synced.json is pushed back.
- down: garments in MongoDB the phone doesn't have (e.g. saved from the web)
        are written to the phone with their generated views. A web garment's
        thumbnail is its *reference* photo, so it goes to reference.jpg; the
        phone then draws the garment's own front view and it syncs back up.

Settings come from web/.env.local (MONGODB_URI, MONGODB_DB), like the web studio.
"""

from __future__ import annotations

import base64
import json
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path

GARMENTS = "Documents/garments"
REPO = Path(__file__).resolve().parents[3]


def settings() -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if k.startswith("MONGODB_")}
    path = REPO / "web/.env.local"
    if path.exists():
        for line in path.read_text().splitlines():
            m = re.match(r"\s*(MONGODB_[A-Z_]+)\s*=\s*(.*)$", line)
            if m and m.group(1) not in env:
                env[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return env


def database():
    import certifi
    from pymongo import MongoClient

    env = settings()
    if not env.get("MONGODB_URI"):
        return None
    client = MongoClient(env["MONGODB_URI"], tlsCAFile=certifi.where(), serverSelectionTimeoutMS=10000)
    return client[env.get("MONGODB_DB") or "blazeres"]


class Wardrobe:
    def __init__(self, device, root: Path):
        self.device = device
        self.root = root / "wardrobe"
        self.db = database()

    def sync(self) -> list[str]:
        """One pass both ways. Returns log lines."""
        if self.db is None:
            return []
        try:
            files = self.device.list_files(GARMENTS)
        except RuntimeError:
            files = []  # no garments folder on the phone yet
        on_phone = {p.split("/")[0] for p in files if p.endswith("/garment.json")}
        synced = {p.split("/")[0] for p in files if p.endswith("/synced.json")}
        log = []
        for gid in sorted(on_phone - synced):
            log.append(self.upload(gid, files))
        for doc in self.db.garments.find({}, {"embedding": 0, "thumbnails": {"$slice": 1}}):
            gid = str(doc["_id"])
            if gid not in on_phone:
                log.append(self.download(doc))
        return log

    def upload(self, gid: str, files: list[str]) -> str:
        from bson.binary import Binary

        local = self.root / gid
        shutil.rmtree(local, ignore_errors=True)
        self.device.pull(f"{GARMENTS}/{gid}", local)
        g = json.loads((local / "garment.json").read_text())
        views = sorted((local / "views").glob("*.jpg"), key=lambda p: int(p.stem)) if (local / "views").exists() else []
        request = json.loads((local / "request.json").read_text()) if (local / "request.json").exists() else None
        order = json.loads((local / "order.json").read_text()) if (local / "order.json").exists() else None
        now = datetime.now(timezone.utc)
        self.db.garments.update_one(
            {"_id": gid},
            {
                "$set": {
                    "title": g.get("name"),
                    "garment": g.get("name"),
                    "family": g.get("spec", {}).get("family"),
                    "spec": g.get("spec", {}),
                    "features": g.get("features", []),
                    "measurements": g.get("measurements", {}),
                    "fit": g.get("fit") or {},  # the wearer's adjustments from the fitting, cm
                    "look": g.get("look"),  # how it should look, in words; the pictures follow it
                    "forSale": bool(g.get("forSale")),  # offered in the marketplace
                    "seamstressRequest": request,  # older garments: where, by when, budget, cloth, notes
                    "order": order,  # the seamstress chosen, price, delivery address, card's last 4 digits
                    "source": g.get("source", "iphone"),
                    "views": [int(p.stem) for p in views],
                    "updatedAt": now,
                },
                "$setOnInsert": {"createdAt": _date(g.get("created")) or now},
            },
            upsert=True,
        )
        self.db.garment_views.delete_many({"garmentId": gid})
        docs = [{"garmentId": gid, "kind": "view", "angle": int(p.stem), "mime": "image/jpeg",
                 "image": Binary(p.read_bytes()), "createdAt": now} for p in views]
        if (local / "tryon.jpg").exists():
            docs.append({"garmentId": gid, "kind": "tryon", "mime": "image/jpeg",
                         "image": Binary((local / "tryon.jpg").read_bytes()), "createdAt": now})
        if docs:
            self.db.garment_views.insert_many(docs)
        marker = local / "synced.json"
        marker.write_text(json.dumps({"at": now.isoformat(), "views": len(views)}))
        self.device.push(marker, f"{GARMENTS}/{gid}/synced.json")
        return f"wardrobe: uploaded {g.get('name')} ({len(views)} views)"

    def download(self, doc: dict) -> str:
        gid = str(doc["_id"])
        local = self.root / gid
        shutil.rmtree(local, ignore_errors=True)
        (local / "views").mkdir(parents=True)
        spec = doc.get("spec") or {}
        if "family" not in spec:
            spec = {"family": doc.get("family") or "coat", **spec}
        name = doc.get("title") or doc.get("garment") or "Garment"
        garment = {
            "id": gid,
            "name": str(name)[:60].capitalize(),
            "spec": spec,
            "features": doc.get("features") or [],
            "measurements": {k: v for k, v in (doc.get("measurements") or {}).items() if isinstance(v, (int, float))},
            "created": (_date(doc.get("createdAt")) or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "source": doc.get("source") or "web",
            "fit": {k: v for k, v in (doc.get("fit") or {}).items() if isinstance(v, (int, float))} or None,
            "look": doc.get("look") if isinstance(doc.get("look"), str) else None,
            "forSale": True if doc.get("forSale") is True else None,
        }
        (local / "garment.json").write_text(json.dumps(garment, indent=2, default=str))
        n = 0
        for v in self.db.garment_views.find({"garmentId": gid}):
            if v.get("kind") == "tryon":
                (local / "tryon.jpg").write_bytes(bytes(v["image"]))
            else:
                (local / "views" / f"{v['angle']}.jpg").write_bytes(bytes(v["image"]))
                n += 1
        thumb = (doc.get("thumbnails") or [None])[0] or doc.get("thumbnail")
        if isinstance(thumb, str) and "," in thumb:  # web garments: the reference photo, not the garment
            (local / "reference.jpg").write_bytes(base64.b64decode(thumb.split(",", 1)[1]))
        (local / "synced.json").write_text(json.dumps({"at": datetime.now(timezone.utc).isoformat(), "views": n}))
        self.device.push(local, f"{GARMENTS}/{gid}")
        return f"wardrobe: downloaded {garment['name']} ({n} view{'s' if n != 1 else ''})"


def _date(v):
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if isinstance(v, str):
        try:
            return datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None
