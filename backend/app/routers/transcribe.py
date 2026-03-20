"""
transcribe.py
-------------
Speech-to-text endpoint using Groq Whisper.
Used by both push-to-talk (voice-to-text) and Voice Mode.

POST /transcribe/  — accepts an audio file, returns { text }
"""

import os
import tempfile
from fastapi import APIRouter, UploadFile, File, HTTPException
from groq import Groq

router = APIRouter()

GROQ_API_KEY  = os.getenv("GROQ_API_KEY")
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "whisper-large-v3-turbo")

# Supported audio formats by Groq Whisper
SUPPORTED_AUDIO_TYPES = {
    "audio/m4a", "audio/mp4", "audio/mpeg", "audio/mp3",
    "audio/wav", "audio/webm", "audio/ogg", "audio/flac",
    "audio/x-m4a", "audio/aac", "application/octet-stream",
}


@router.post("/")
async def transcribe_audio(file: UploadFile = File(...)):
    """
    Transcribe audio using Groq Whisper.
    Accepts: m4a, mp3, wav, webm, ogg, flac
    Returns: { text, language, duration }
    """
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not set.")

    # Read audio bytes
    audio_bytes = await file.read()
    if len(audio_bytes) == 0:
        raise HTTPException(status_code=400, detail="Uploaded audio file is empty.")

    print(f"[WHISPER] Received: {file.filename}, size: {len(audio_bytes)} bytes")

    # Determine file extension for temp file
    filename   = file.filename or "audio.m4a"
    ext        = filename.rsplit(".", 1)[-1].lower() if "." in filename else "m4a"
    valid_exts = {"m4a", "mp4", "mp3", "wav", "webm", "ogg", "flac", "aac"}
    if ext not in valid_exts:
        ext = "m4a"  # safe default

    # Write to temp file — Groq requires a real file object
    with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        client = Groq(api_key=GROQ_API_KEY)

        with open(tmp_path, "rb") as audio_file:
            transcription = client.audio.transcriptions.create(
                model=WHISPER_MODEL,
                file=(filename, audio_file, f"audio/{ext}"),
                response_format="verbose_json",
            )

        text     = transcription.text.strip() if hasattr(transcription, "text") else ""
        language = getattr(transcription, "language", "unknown")
        duration = getattr(transcription, "duration", None)

        print(f"[WHISPER] Detected language: '{language}'")
        print(f"[WHISPER] Transcribed: '{text[:80]}{'...' if len(text) > 80 else ''}'")

        return {
            "text":     text,
            "language": language,
            "duration": duration,
        }

    except Exception as e:
        print(f"[WHISPER] Error: {e}")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")

    finally:
        # Clean up temp file
        try:
            os.unlink(tmp_path)
        except Exception:
            pass