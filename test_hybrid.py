r"""
Full validation test for both ASL grammar engine and hybrid service.
Run from project root:
  venv\Scripts\python.exe test_hybrid.py
"""
import sys, os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

from services.asl_grammar import english_to_asl_gloss, asl_gloss_string
from services.hybrid_service import get_animations, get_asl_gloss, dataset_stats

SEP = "=" * 60

# ── 1. Dataset sizes ────────────────────────────────────────────────────────
print(SEP)
print("  DATASET STATS")
print(SEP)
stats = dataset_stats()
for k, v in stats.items():
    print(f"  {k:12s}: {v} entries")

# ── 2. ASL Grammar conversions ──────────────────────────────────────────────
print()
print(SEP)
print("  ASL GRAMMAR CONVERSION (English -> ASL Gloss)")
print(SEP)

grammar_tests = [
    ("I am going to school",       "ME GO SCHOOL"),
    ("I am hungry",                "ME HUNGRY"),
    ("What is your name?",         "WHAT YOUR NAME"),
    ("How are you?",               "HOW YOU"),
    ("I don't understand",         "ME NOT KNOW"),
    ("I want to eat food",         "ME WANT EAT FOOD"),
    ("She is happy today",         "SHE HAPPY TODAY"),
    ("I am going to the hospital", "ME GO HOSPITAL"),
    ("Please help me",             "PLEASE HELP ME"),
    ("Good morning",               "GOOD MORNING"),
]

passed_g = 0
for eng, expected in grammar_tests:
    result = asl_gloss_string(eng)
    ok = result == expected
    if ok:
        passed_g += 1
    status = "PASS" if ok else "DIFF"
    print(f"  [{status}] \"{eng}\"")
    print(f"         Expected: {expected}")
    print(f"         Got     : {result}")
    print()

print(f"  Grammar: {passed_g}/{len(grammar_tests)} exact matches")

# ── 3. Full hybrid pipeline ──────────────────────────────────────────────────
print()
print(SEP)
print("  HYBRID ANIMATION PIPELINE (all 4 tiers)")
print(SEP)

hybrid_tests = [
    ("i want coffee",        "PHRASE (raw)  -> me.glb, want.glb, coffee.glb"),
    ("I am going to school", "PHRASE (ASL)  -> me.glb, go.glb, school.glb"),
    ("good morning",         "PHRASE (raw)  -> good.glb, morning.glb"),
    ("how are you",          "PHRASE (raw)  -> you.glb, how.glb"),
    ("thank you",            "PHRASE (raw)  -> thankyou.glb"),
    ("I like tea",           "WORD          -> me.glb, like.glb, tea.glb"),
    ("She is happy",         "WORD          -> she.glb, happy.glb"),
    ("I don't understand",   "PHRASE (ASL)  -> me.glb, not.glb, know.glb"),
    ("I want project update","MIXED(spell)  -> me,want,p,r,o,j,e,c,t,..."),
    ("xyz abc",              "FINGERSPELL   -> x.glb, y.glb, z.glb, ..."),
]

passed_h = 0
for text, note in hybrid_tests:
    result = get_animations(text)
    asl    = get_asl_gloss(text)
    ok = len(result) > 0
    if ok:
        passed_h += 1
    status = "OK" if ok else "EMPTY"
    print(f"  [{status}] \"{text}\"")
    print(f"         ASL  : {asl}")
    print(f"         Anim : {result}  ({note})")
    print()

print(SEP)
print(f"  Grammar : {passed_g}/{len(grammar_tests)} exact matches")
print(f"  Pipeline: {passed_h}/{len(hybrid_tests)} produced animations")
print(SEP)
