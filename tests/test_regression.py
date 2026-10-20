"""
Regression and Linguistic Invariant Test Suite
==============================================
Validates dataset integrity, linguistic invariance, and edge cases.
Run:
    python tests/test_regression.py
"""

import sys
import json
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = PROJECT_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.asl_grammar import english_to_asl_gloss
from services.hybrid_service import get_animations_with_urls, get_asl_gloss
from services.facial_service import analyze_sentence

class TestSignAIRegression(unittest.TestCase):
    def test_01_dataset_json_integrity(self):
        """Verify all JSON dataset files are valid JSON and non-empty."""
        files = [
            PROJECT_ROOT / "data" / "isl_dataset.json",
            PROJECT_ROOT / "data" / "animation_mapping.json",
            PROJECT_ROOT / "dataset" / "phrases.json",
            PROJECT_ROOT / "dataset" / "words.json",
            PROJECT_ROOT / "dataset" / "alphabet.json",
            PROJECT_ROOT / "dataset" / "lifeprint_dictionary.json",
        ]
        for fp in files:
            self.assertTrue(fp.exists(), f"Missing dataset file: {fp}")
            with open(fp, "r", encoding="utf-8") as f:
                data = json.load(f)
                self.assertGreater(len(data), 0, f"Empty dataset file: {fp}")

    def test_02_linguistic_benchmark_sentences(self):
        """Verify core benchmark sentences produce expected ASL structures."""
        # 1. I am going to school -> ME GO SCHOOL
        g1 = english_to_asl_gloss("I am going to school.")
        self.assertEqual(g1, ["ME", "GO", "SCHOOL"])

        # 2. How are you? -> HOW YOU
        g2 = english_to_asl_gloss("How are you?")
        self.assertEqual(g2, ["HOW", "YOU"])

        # 3. I need water -> ME NEED WATER
        g3 = english_to_asl_gloss("I need water.")
        self.assertEqual(g3, ["ME", "NEED", "WATER"])

        # 4. Yesterday I visited my friend -> Tense fronting
        g4 = english_to_asl_gloss("Yesterday I visited my friend.")
        self.assertEqual(g4[0], "YESTERDAY")
        self.assertIn("FRIEND", g4)

    def test_03_negation_and_questions_facial_nms(self):
        """Verify facial non-manual signals detect wh-questions, yn-questions, and negation."""
        wh = analyze_sentence("Where is the hospital?")
        self.assertEqual(wh["expression"], "wh_question")
        self.assertEqual(wh["eyebrows"], "furrowed")

        yn = analyze_sentence("Are you hungry?")
        self.assertEqual(yn["expression"], "yn_question")
        self.assertEqual(yn["eyebrows"], "raised")

        neg = analyze_sentence("I cannot sleep")
        self.assertEqual(neg["expression"], "negative")
        self.assertTrue(neg.get("head_shake", False))

    def test_04_fingerspelling_completeness(self):
        """Verify that any unrecognized alphanumeric token is completely fingerspelled."""
        word = "zebra123"
        anims, urls = get_animations_with_urls(word)
        expected_tokens = ["z.glb", "e.glb", "b.glb", "r.glb", "a.glb", "1.glb", "2.glb", "3.glb"]
        self.assertEqual(anims, expected_tokens)

    def test_05_repeated_concurrent_pipeline_calls(self):
        """Verify pipeline is stateless and safe across repeated calls."""
        for _ in range(50):
            anims, urls = get_animations_with_urls("I am happy")
            self.assertEqual(anims, ["me.glb", "happy.glb"])

if __name__ == "__main__":
    unittest.main()
