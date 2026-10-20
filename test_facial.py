"""
Smoke test: facial_service + hybrid_service
Run from project root:  venv\Scripts\python test_facial.py
"""
import sys, os
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

from services.facial_service import analyze_sentence
from services.hybrid_service import get_animations_with_urls, get_asl_gloss

# ── Facial service tests ───────────────────────────────────────────────────────
CASES = [
    ("I am going to school",   "neutral"),
    ("Where is the hospital?", "wh_question"),
    ("Are you happy?",         "yn_question"),
    ("I cannot walk fast",     "negative"),
    ("I am very happy today",  "happy"),
    ("He is angry",            "angry"),
    ("She is sad and crying",  "sad"),
]

print("=" * 60)
print("FACIAL SERVICE TESTS")
print("=" * 60)
all_pass = True
for sentence, expected in CASES:
    r = analyze_sentence(sentence)
    got = r["expression"]
    ok  = got == expected
    if not ok:
        all_pass = False
    tag = "PASS" if ok else "FAIL"
    print(f"  [{tag}]  {sentence:<45s}  ->  {got}  (expected {expected})")

# ── Hybrid service test ────────────────────────────────────────────────────────
print()
print("=" * 60)
print("HYBRID SERVICE TESTS")
print("=" * 60)
sentence = "I am going to school"
filenames, urls = get_animations_with_urls(sentence)
gloss = get_asl_gloss(sentence)
print(f"  sentence  : {sentence}")
print(f"  gloss     : {gloss}")
print(f"  animations: {filenames}")
print(f"  urls      : {urls[:2]}...")

# ── Summary ───────────────────────────────────────────────────────────────────
print()
print("=" * 60)
print("ALL TESTS PASSED" if all_pass else "SOME FACIAL TESTS FAILED")
print("=" * 60)
