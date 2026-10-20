import os
import io
import wave
import tempfile
import shutil
import numpy as np

_model = None

def get_whisper_model():
    global _model
    if _model is None:
        import whisper
        _model = whisper.load_model("base")
    return _model

def _wav_bytes_to_np(audio_bytes: bytes) -> np.ndarray:
    with wave.open(io.BytesIO(audio_bytes), "rb") as wf:
        channels = wf.getnchannels()
        sampwidth = wf.getsampwidth()
        framerate = wf.getframerate()
        frames = wf.readframes(wf.getnframes())

        if sampwidth == 2:
            data = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
        elif sampwidth == 1:
            data = (np.frombuffer(frames, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
        elif sampwidth == 4:
            data = np.frombuffer(frames, dtype=np.int32).astype(np.float32) / 2147483648.0
        else:
            raise ValueError(f"Unsupported sample width: {sampwidth}")

        if channels > 1:
            data = data.reshape(-1, channels).mean(axis=1)

        # Resample to 16000 Hz if needed
        if framerate != 16000 and len(data) > 0:
            target_len = int(len(data) * 16000 / framerate)
            data = np.interp(
                np.linspace(0, len(data), target_len, endpoint=False),
                np.arange(len(data)),
                data
            ).astype(np.float32)

        return data

def transcribe_audio_bytes(audio_bytes: bytes, file_ext: str = ".wav") -> dict:
    model = get_whisper_model()
    
    # 1. Try decoding directly as pure WAV without external ffmpeg dependency
    try:
        audio_arr = _wav_bytes_to_np(audio_bytes)
        result = model.transcribe(audio_arr, fp16=False)
        return {
            "text": result.get("text", "").strip(),
            "language": result.get("language", "en")
        }
    except Exception:
        # Not a standard PCM WAV file or WAV header absent; fall back to temporary file
        pass

    # 2. Fall back to temp file transcription (requires ffmpeg for webm/mp3/ogg)
    with tempfile.NamedTemporaryFile(suffix=file_ext, delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        result = model.transcribe(tmp_path, fp16=False)
        return {
            "text": result.get("text", "").strip(),
            "language": result.get("language", "en")
        }
    except Exception as e:
        if "ffmpeg" in str(e).lower() or not shutil.which("ffmpeg"):
            raise RuntimeError(
                "Whisper requires FFmpeg to transcribe compressed formats (.webm, .mp3). "
                "Please install FFmpeg or provide uncompressed PCM 16kHz WAV."
            ) from e
        raise
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass
