"""
Comprehensive Backend API & Integration Test Suite
==================================================
Tests all REST endpoints, WebSocket streaming, and health checks.
Run:
    pytest tests/test_api.py -v
or
    python tests/test_api.py
"""

import sys
import os
import unittest
from pathlib import Path
from fastapi.testclient import TestClient

# Ensure backend is on sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = PROJECT_ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from main import app

class TestSignAIAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_01_health_check(self):
        """Verify GET /health reports OK status and dataset metrics."""
        resp = self.client.get("/health")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data.get("status"), "ok")
        stats = data.get("stats", {})
        self.assertGreaterEqual(stats.get("phrases", 0), 80)
        self.assertGreaterEqual(stats.get("words", 0), 100)
        self.assertGreaterEqual(stats.get("alphabet", 0), 26)

    def test_02_generate_gloss_basic(self):
        """Verify POST /generate-gloss converts English sentence to ASL gloss."""
        resp = self.client.post("/generate-gloss", json={"sentence": "I am going to school"})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data.get("gloss"), "ME GO SCHOOL")
        self.assertIn("GO", data.get("tokens", []))

    def test_03_generate_gloss_question(self):
        """Verify WH-question glossing."""
        resp = self.client.post("/generate-gloss", json={"sentence": "Where is the hospital?"})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("HOSPITAL", data.get("tokens", []))
        self.assertIn("WHERE", data.get("tokens", []))

    def test_04_process_text_hybrid(self):
        """Verify POST /process-text returns animations, urls, and facial NMS."""
        resp = self.client.post("/process-text", json={"text": "I need water"})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("animations", data)
        self.assertIn("urls", data)
        self.assertIn("facial", data)
        self.assertGreater(data.get("count", 0), 0)
        self.assertTrue(any("water.glb" in a for a in data["animations"]))

    def test_05_unsupported_words_fingerspell(self):
        """Verify unknown words fallback cleanly to fingerspelled tokens without 500 error."""
        resp = self.client.post("/process-text", json={"text": "quantum"})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        # 'quantum' should fingerspell letters
        anims = data.get("animations", [])
        self.assertIn("q.glb", anims)
        self.assertIn("u.glb", anims)

    def test_06_websocket_realtime(self):
        """Verify WebSocket /ws/realtime streams animations for input text."""
        with self.client.websocket_connect("/ws/realtime") as ws:
            ws.send_text('{"type": "text", "text": "hello"}')
            msg = ws.receive_json()
            self.assertEqual(msg.get("type"), "animations")
            self.assertEqual(msg.get("sentence"), "hello")
            self.assertTrue(len(msg.get("animations", [])) > 0)

    def test_07_empty_and_special_characters(self):
        """Verify robust handling of empty input and special characters."""
        resp = self.client.post("/process-text", json={"text": "   !@#$%^   "})
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIsInstance(data.get("animations"), list)

if __name__ == "__main__":
    unittest.main()
