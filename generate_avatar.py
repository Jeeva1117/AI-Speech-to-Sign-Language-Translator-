"""
generate_avatar.py
──────────────────
Generates a minimal valid avatar.glb placeholder.
Run ONCE before starting the server if you don't have a real avatar GLB.

    python generate_avatar.py
"""

import json
import os
import struct

ASSETS_DIR = os.path.join(os.path.dirname(__file__), "assets")


def make_minimal_glb(name: str) -> bytes:
    gltf_json = {
        "asset": {"version": "2.0", "generator": "SignAI-Placeholder"},
        "extras": {"name": name, "placeholder": True},
    }
    json_bytes = json.dumps(gltf_json, separators=(",", ":")).encode("utf-8")
    pad = (4 - len(json_bytes) % 4) % 4
    json_bytes += b" " * pad
    chunk_length = len(json_bytes)
    chunk_type   = 0x4E4F534A
    total_length = 12 + 8 + chunk_length
    header = struct.pack("<III", 0x46546C67, 2, total_length)
    chunk  = struct.pack("<II", chunk_length, chunk_type) + json_bytes
    return header + chunk


os.makedirs(ASSETS_DIR, exist_ok=True)
avatar_path = os.path.join(ASSETS_DIR, "avatar.glb")
if not os.path.exists(avatar_path):
    with open(avatar_path, "wb") as f:
        f.write(make_minimal_glb("avatar"))
    print(f"[OK]  Created placeholder: {avatar_path}")
else:
    print(f"[--]  avatar.glb already exists: {avatar_path}")

print("\n  >>  Replace assets/avatar.glb with a real GLTF/GLB humanoid avatar.")
print("      Free sources: Mixamo (mixamo.com), ReadyPlayerMe, Sketchfab.\n")
