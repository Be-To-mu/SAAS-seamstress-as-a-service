"""Generate the app's spoken scan instructions with ElevenLabs.

    .venv/bin/python tools/voice/generate.py

Reads ELEVENLABS_API_KEY (and optionally ELEVENLABS_VOICE_ID) from the
untracked .env at the repo root, and writes ios/Seamstress/Voice/<id>.mp3 for
every prompt in prompts.json. Clips whose text and voice haven't changed are
skipped. The mp3s are committed, so building the app needs no key.
"""

import hashlib
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
PROMPTS = Path(__file__).with_name("prompts.json")
OUT = REPO / "ios/Seamstress/Voice"
DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM"  # "Rachel", a stock ElevenLabs voice
MODEL = "eleven_multilingual_v2"


def read_env() -> dict[str, str]:
    env = {}
    path = REPO / ".env"
    if path.exists():
        for line in path.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"')
    return env


def speak(text: str, voice: str, key: str) -> bytes:
    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128",
        data=json.dumps({"text": text, "model_id": MODEL}).encode(),
        headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def main() -> None:
    env = read_env()
    key = env.get("ELEVENLABS_API_KEY")
    if not key:
        sys.exit(f"No ELEVENLABS_API_KEY in {REPO / '.env'}")
    voice = env.get("ELEVENLABS_VOICE_ID", DEFAULT_VOICE)
    prompts = json.loads(PROMPTS.read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}

    for pid, text in prompts.items():
        digest = hashlib.sha256(f"{voice}|{MODEL}|{text}".encode()).hexdigest()[:16]
        clip = OUT / f"{pid}.mp3"
        if manifest.get(pid) == digest and clip.exists():
            print(f"unchanged  {pid}")
            continue
        try:
            clip.write_bytes(speak(text, voice, key))
        except urllib.error.HTTPError as e:
            sys.exit(f"ElevenLabs error for {pid}: {e.code} {e.read().decode()[:300]}")
        manifest[pid] = digest
        print(f"wrote      {pid}.mp3")
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
