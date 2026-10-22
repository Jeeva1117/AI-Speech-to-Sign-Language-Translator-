"""
generate_placeholder_assets.py
─────────────────────────────
Generates minimal valid GLB placeholder files for every word in the
animation dictionary.  Run this ONCE to populate assets/animations/ so
the API server can respond with real file paths even before you add
real motion-capture GLB files.

Usage:
    cd project_root
    python generate_placeholder_assets.py

Requirements: pip install pygltflib
"""

import json
import os
import struct

ANIMATIONS_DIR = os.path.join(os.path.dirname(__file__), "assets", "animations")

# --------------------------------------------------------------------------
# Words that need placeholder GLBs
# --------------------------------------------------------------------------
WORDS = [
    "default", "hello", "bye", "thanks", "please", "sorry",
    "i", "my", "you", "your", "we", "they", "he", "she",
    "go", "come", "eat", "drink", "walk", "run", "play", "sleep",
    "work", "help", "learn", "study", "like", "love", "want", "need",
    "make", "see", "know", "think", "talk", "read", "write", "wait",
    "watch", "feel",
    "school", "home", "hospital", "store", "library", "park", "office", "church",
    "mother", "father", "sister", "brother", "friend", "teacher", "doctor", "student",
    "name", "time", "day", "week", "year", "food", "water", "money", "book",
    "phone", "car",
    "good", "bad", "happy", "sad", "sick", "hot", "cold", "big", "small",
    "fast", "slow", "new", "old",
    "what", "who", "where", "when", "why", "how",
    "1", "2", "3", "4", "5",
    "not", "no", "yes",
]


def make_minimal_glb(word: str) -> bytes:
    """
    Build the smallest valid GLB (version 2) that contains:
      - An empty glTF JSON with a custom 'extras.sign' field
      - No geometry or animation data

    This lets Three.js / GLTFLoader load the file without errors.
    """
    gltf_json = {
        "asset": {"version": "2.0", "generator": "SignAI-Placeholder"},
        "extras": {"sign": word, "placeholder": True},
    }
    json_bytes = json.dumps(gltf_json, separators=(",", ":")).encode("utf-8")

    # GLB chunk must be 4-byte aligned, pad with spaces
    pad = (4 - len(json_bytes) % 4) % 4
    json_bytes += b" " * pad

    chunk_length = len(json_bytes)
    chunk_type   = 0x4E4F534A   # "JSON" in little-endian

    total_length = 12 + 8 + chunk_length   # header + chunk-header + chunk-data

    header = struct.pack("<III", 0x46546C67, 2, total_length)   # magic, version, length
    chunk  = struct.pack("<II", chunk_length, chunk_type) + json_bytes

    return header + chunk


def collect_all_mapped_words():
    all_words = set(WORDS)
    base_dir = os.path.dirname(__file__)

    dataset_files = [
        os.path.join(base_dir, "dataset", "words.json"),
        os.path.join(base_dir, "dataset", "phrases.json"),
        os.path.join(base_dir, "dataset", "alphabet.json"),
        os.path.join(base_dir, "data", "animation_mapping.json"),
    ]

    for df in dataset_files:
        if os.path.exists(df):
            try:
                with open(df, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for k, v in data.items():
                    if isinstance(v, str) and v.endswith(".glb"):
                        all_words.add(v[:-4].lower())
                    elif isinstance(v, list):
                        for item in v:
                            if isinstance(item, str) and item.endswith(".glb"):
                                all_words.add(item[:-4].lower())
            except Exception as e:
                print(f"[!] Warning reading {df}: {e}")

    # Ensure alphabet and numbers 0-9
    for ch in "abcdefghijklmnopqrstuvwxyz":
        all_words.add(ch)
    for n in "0123456789":
        all_words.add(n)

    return sorted(list(all_words))


def main():
    os.makedirs(ANIMATIONS_DIR, exist_ok=True)
    all_words = collect_all_mapped_words()
    created = 0

    for word in all_words:
        path = os.path.join(ANIMATIONS_DIR, f"{word}.glb")
        if not os.path.exists(path):
            glb = make_minimal_glb(word)
            with open(path, "wb") as f:
                f.write(glb)
            created += 1

    print(f"[OK]  Checked {len(all_words)} animations. Created {created} placeholder GLB file(s) in: {ANIMATIONS_DIR}")
    print("      Replace them with real motion-capture GLBs as you acquire them.")


if __name__ == "__main__":
    main()
