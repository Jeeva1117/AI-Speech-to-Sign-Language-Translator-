"""
Download a realistic human avatar GLB for SignAI.
Tries multiple free, publicly accessible sources.
"""
import urllib.request
import os
import sys

ASSETS_DIR = os.path.join(os.path.dirname(__file__), "assets")
OUT_PATH   = os.path.join(ASSETS_DIR, "avatar.glb")

# Multiple fallback GLB sources (realistic/stylized humans)
SOURCES = [
    # Ready Player Me – half-body female avatar (no auth needed for direct download)
    ("Ready Player Me sample", "https://models.readyplayer.me/638df693d72bffc6fa17943c.glb?morphTargets=ARKit&textureAtlas=1024"),
    # Three.js official Soldier character (rigged humanoid)
    ("Three.js Soldier",       "https://threejs.org/examples/models/gltf/Soldier.glb"),
    # glTF Sample – Brain Stem (rigged human)
    ("glTF BrainStem",         "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/BrainStem/glTF-Binary/BrainStem.glb"),
    # Sketchfab open-licensed stylized human
    ("RobotExpressive",        "https://threejs.org/examples/models/gltf/RobotExpressive/RobotExpressive.glb"),
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept":     "application/octet-stream,*/*",
}

os.makedirs(ASSETS_DIR, exist_ok=True)

def try_download(label, url):
    print(f"  Trying: {label}\n    {url}")
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
        if len(data) < 5000:
            print(f"    ✗ File too small ({len(data)} bytes), skipping.")
            return False
        with open(OUT_PATH, "wb") as f:
            f.write(data)
        mb = len(data) / 1024 / 1024
        print(f"    ✓ Saved {mb:.2f} MB → {OUT_PATH}")
        return True
    except Exception as e:
        print(f"    ✗ Failed: {e}")
        return False

print("=== SignAI Avatar Downloader ===")
for label, url in SOURCES:
    if try_download(label, url):
        print(f"\n✅ Avatar ready: {OUT_PATH}")
        sys.exit(0)

print("\n❌ All sources failed. Using procedural avatar fallback.")
sys.exit(1)
