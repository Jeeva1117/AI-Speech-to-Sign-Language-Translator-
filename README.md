# 🤟 SignAI — Real-Time Speech-to-Sign Language Avatar

A production-ready full-stack application that converts spoken English into sign language animations using a 3D avatar.

---

## Architecture Overview

```
User speaks → Web Speech API → text
           → FastAPI /generate-gloss → ASL gloss tokens
           → FastAPI /get-animations → GLB filenames + URLs
           → Three.js AnimationEngine → sequential arm animations
```

```
project/
├── frontend/
│   ├── index.html       ← Premium 3-panel UI
│   ├── style.css        ← Dark-mode design system + animations
│   └── app.js           ← 6-class modular architecture (Three.js)
│
├── backend/
│   ├── main.py          ← FastAPI app, CORS, static file server
│   ├── routes/
│   │   ├── speech.py    ← POST /speech-to-text  (Whisper)
│   │   ├── gloss.py     ← POST /generate-gloss
│   │   └── animation.py ← POST /get-animations
│   ├── services/
│   │   ├── speech_service.py    ← Whisper wrapper (lazy load)
│   │   ├── nlp_service.py       ← Rule-based English → ASL gloss
│   │   └── animation_service.py ← 80+ word animation dictionary
│   └── models/
│       └── schemas.py   ← Pydantic request/response models
│
├── assets/
│   ├── avatar.glb              ← 3D humanoid avatar (replace with real)
│   └── animations/             ← GLB animation files per sign
│
├── generate_avatar.py           ← Creates placeholder avatar.glb
├── generate_placeholder_assets.py ← Creates all animation placeholders
└── requirements.txt
```

---

## Tech Stack

| Layer     | Technology                        |
|-----------|-----------------------------------|
| Frontend  | HTML5, Vanilla CSS, ES Modules    |
| 3D Engine | Three.js 0.161 (CDN)              |
| Speech    | Web Speech API (browser built-in) |
| Backend   | Python 3.10+ / FastAPI            |
| STT       | OpenAI Whisper `base` model       |
| NLP       | Rule-based (no LLMs)              |

---

## Quick Start

### Step 1 — Set up Python environment

```powershell
cd c:\Users\acer\Desktop\aisignlanguagetranslator2026

# Create & activate virtual environment
python -m venv venv
.\venv\Scripts\Activate.ps1

# Install dependencies
pip install -r requirements.txt
```

> **Note:** `openai-whisper` requires [ffmpeg](https://ffmpeg.org/download.html).
> Install it and make sure it's on your PATH.
> Download: https://www.gyan.dev/ffmpeg/builds/ → grab the "release essentials" zip.

### Step 2 — Generate placeholder GLB assets

```powershell
# From project root (venv active)
python generate_avatar.py
python generate_placeholder_assets.py
```

This creates `assets/avatar.glb` and `assets/animations/*.glb` placeholders.
The **procedural avatar** built into Three.js will show automatically, so the app works even before you replace these with real GLBs.

### Step 3 — Start FastAPI server

FastAPI serves the entire application (API, WebSockets, static assets, and frontend) on port 8000:

```powershell
# From project root (venv active)
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

- Web Application: **http://127.0.0.1:8000**
- Interactive API Docs: **http://127.0.0.1:8000/docs**
- WebSocket Streaming: **ws://127.0.0.1:8000/ws/realtime**

*(Optional) You can also serve the frontend standalone with `python -m http.server 5500` from the `frontend/` folder.*

### Step 4 — Run Automated Tests

```powershell
python tests/test_api.py
python tests/test_regression.py
python test_facial.py
python test_hybrid.py
```

---

## API Reference

### `POST /speech-to-text`
Upload an audio file, get back transcribed text.
```json
// Response
{ "text": "I am going to school", "language": "en" }
```

### `POST /generate-gloss`
```json
// Request
{ "sentence": "I am going to school" }

// Response
{ "original": "I am going to school", "gloss": "i go school", "tokens": ["i","go","school"] }
```

### `POST /get-animations`
```json
// Request
{ "gloss": "i go school" }

// Response
{ "animations": ["i.glb","go.glb","school.glb"], "urls": ["/assets/animations/i.glb","..."] }
```

---

## Frontend Features

| Feature | Description |
|---------|-------------|
| 🎙️ Mic Button | Web Speech API, real-time interim results |
| ✏️ Manual Input | Type text directly, press Enter |
| 🤖 3D Avatar | Three.js scene with orbit controls + lighting |
| 🔄 Procedural Fallback | Built-in humanoid avatar when no GLB found |
| 📋 Animation Queue | Visual chips showing playback progress |
| ⏯️ Playback Controls | Play / Pause / Stop + Speed slider |
| 🎮 Demo Mode | Works fully offline without backend |
| 📜 Session Log | History of all translated sentences |
| ✨ Particle BG | Animated background canvas |

---

## Adding Real Animations

1. Download free GLB files from **[Mixamo](https://www.mixamo.com)** (sign language packs)
   or **[Sketchfab](https://sketchfab.com)** (search "sign language ASL animation")
2. Name each file after its ASL token: `go.glb`, `hello.glb`, `school.glb` …
3. Drop them into `assets/animations/`
4. Replace `assets/avatar.glb` with a compatible rigged humanoid
5. The animation engine will pick them up automatically

---

## NLP Gloss Logic

The rule-based NLP pipeline (no ML models):

```
"I am going to school"
  → lowercase  →  "i am going to school"
  → contractions  →  (none here)
  → strip punctuation
  → lemmatize  →  "i am go to school"
  → remove stopwords {am, to}  →  ["i", "go", "school"]
  → join  →  "i go school"
```

Stopwords removed: `is, am, are, was, were, a, an, the, to, of, in, on, at, for, with, and, or, but, do, have, will, would, could, should, may, might…`

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `uvicorn` not found | Make sure venv is active: `.\venv\Scripts\Activate.ps1` |
| Whisper import error | `pip install openai-whisper` + install ffmpeg |
| CORS error in browser | Backend must be running on port 8000 |
| Mic not working | Use Chrome/Edge; allow microphone permission |
| Avatar not loading | Check `assets/avatar.glb` exists; fallback avatar auto-activates |
| Demo mode stuck on | Click "Live" pill in header; verify backend is running |

---

## Roadmap (Phase 2 & 3)

- [x] Upload audio file → Whisper transcription (`POST /speech-to-text`)
- [x] Finger-spelling fallback (A–Z letter & 0-9 number animations)
- [x] WebSocket real-time streaming (`/ws/realtime`)
- [x] Non-manual facial expressions (wh-questions, yn-questions, emotions)
- [ ] Real skeletal animation blending with morph targets
- [ ] Multi-language support (BSL, ISL, Auslan)
- [ ] Docker compose for one-command deployment
