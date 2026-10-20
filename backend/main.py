import uvicorn
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import re
import os
import json
import sys
from pathlib import Path

# Add backend directory to sys.path so services can be imported cleanly
BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from services.asl_grammar import english_to_asl_gloss, asl_gloss_string
from services.facial_service import analyze_sentence
from services.hybrid_service import get_animations, get_animations_with_urls, get_asl_gloss, dataset_stats

app = FastAPI(title="SignAI Backend", version="3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request / Response Schemas
class TextRequest(BaseModel):
    sentence: str

class ProcessTextRequest(BaseModel):
    text: str

class GlossResponse(BaseModel):
    original: str
    gloss: str
    tokens: list[str]

class AnimationRequest(BaseModel):
    gloss: str

class AnimationResponse(BaseModel):
    animations: list[str]
    urls: list[str]

# ── REST API Endpoints ────────────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    return {"status": "ok", "stats": dataset_stats()}

@app.post("/generate-gloss", response_model=GlossResponse)
async def generate_gloss(req: TextRequest):
    tokens = english_to_asl_gloss(req.sentence)
    gloss = " ".join(tokens)
    return GlossResponse(original=req.sentence, gloss=gloss, tokens=tokens)

@app.post("/t5-gloss/chunks")
async def t5_gloss_chunks(req: TextRequest):
    tokens = english_to_asl_gloss(req.sentence)
    gloss = " ".join(tokens)
    return {
        "sentence": req.sentence,
        "chunks": [{"gloss": gloss}],
        "all_tokens": tokens,
    }

@app.post("/get-animations", response_model=AnimationResponse)
async def get_animations_endpoint(req: AnimationRequest):
    tokens = req.gloss.split()
    animations = []
    urls = []
    for token in tokens:
        glb_filename = f"{token.lower()}.glb"
        animations.append(glb_filename)
        urls.append(f"/assets/animations/{glb_filename}")
    return AnimationResponse(animations=animations, urls=urls)

@app.post("/process-text")
async def process_text(req: ProcessTextRequest):
    animations, urls = get_animations_with_urls(req.text)
    facial = analyze_sentence(req.text)
    return {
        "text": req.text,
        "animations": animations,
        "urls": urls,
        "count": len(animations),
        "facial": facial,
    }

@app.post("/speech-to-text")
async def speech_to_text(file: UploadFile = File(...)):
    try:
        from services.speech_service import transcribe_audio_bytes
        content = await file.read()
        suffix = Path(file.filename or "audio.wav").suffix or ".wav"
        result = transcribe_audio_bytes(content, file_ext=suffix)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Speech recognition error: {str(e)}")

# ── WebSocket Real-Time Endpoint ──────────────────────────────────────────────

@app.websocket("/ws/realtime")
async def websocket_realtime(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            data_text = await websocket.receive_text()
            try:
                data = json.loads(data_text)
            except json.JSONDecodeError:
                await websocket.send_text(json.dumps({"type": "error", "detail": "Invalid JSON"}))
                continue

            msg_type = data.get("type", "")
            if msg_type == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
            elif msg_type == "text":
                text = data.get("text", "").strip()
                if not text:
                    continue
                animations, urls = get_animations_with_urls(text)
                gloss = get_asl_gloss(text)
                facial = analyze_sentence(text)
                tokens = [a.replace(".glb", "") for a in animations]
                response = {
                    "type": "animations",
                    "sentence": text,
                    "chunks": [gloss],
                    "all_tokens": tokens,
                    "animations": animations,
                    "urls": urls,
                    "facial": facial,
                }
                await websocket.send_text(json.dumps(response))
            else:
                await websocket.send_text(json.dumps({"type": "error", "detail": f"Unknown message type: {msg_type}"}))
    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_text(json.dumps({"type": "error", "detail": str(e)}))
        except Exception:
            pass

# ── Static File Mounts ────────────────────────────────────────────────────────
assets_path = PROJECT_ROOT / "assets"
frontend_path = PROJECT_ROOT / "frontend"

if assets_path.exists():
    app.mount("/assets", StaticFiles(directory=str(assets_path)), name="assets")
if frontend_path.exists():
    app.mount("/", StaticFiles(directory=str(frontend_path), html=True), name="frontend")

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
