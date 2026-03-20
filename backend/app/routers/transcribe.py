from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from groq import Groq
import os, tempfile

router = APIRouter()


def _get_client():
    key = os.getenv("GROQ_API_KEY")
    if not key:
        raise ValueError("GROQ_API_KEY not set")
    return Groq(api_key=key)


@router.post("/")
async def transcribe_audio(
    file:     UploadFile = File(...),
    language: str        = Form(default="auto"),
):
    """
    Accepts audio (webm from browser, m4a from mobile) and transcribes via Groq Whisper.
    language="auto" -> Whisper auto-detects language from audio.
    """
    audio_bytes = await file.read()

    print(f"[WHISPER] Received: {file.filename}, size: {len(audio_bytes)} bytes")

    if len(audio_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty audio file received.")
    if len(audio_bytes) < 500:
        raise HTTPException(status_code=400, detail="Audio too short. Please speak for at least 2 seconds.")

    # Detect format
    filename = file.filename or "recording.webm"
    if "webm" in (file.content_type or "") or filename.endswith(".webm"):
        suffix = ".webm"
    elif "m4a" in (file.content_type or "") or filename.endswith(".m4a"):
        suffix = ".m4a"
    elif "mp4" in (file.content_type or "") or filename.endswith(".mp4"):
        suffix = ".mp4"
    elif "wav" in (file.content_type or "") or filename.endswith(".wav"):
        suffix = ".wav"
    else:
        suffix = ".webm"

    whisper_lang_map = {
        "en": "en", "ms": "ms", "zh": "zh", "ta": "ta", "id": "id", "auto": None,
    }
    whisper_lang = whisper_lang_map.get(language.lower(), None)

    client = _get_client()

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        with open(tmp_path, "rb") as audio_file:
            kwargs = {
                "model":           "whisper-large-v3-turbo",
                "file":            audio_file,
                "response_format": "verbose_json",
            }
            if whisper_lang:
                kwargs["language"] = whisper_lang

            transcription = client.audio.transcriptions.create(**kwargs)

        text              = transcription.text.strip() if transcription.text else ""
        detected_language = getattr(transcription, "language", None)

        print(f"[WHISPER] Detected language: '{detected_language}'")
        print(f"[WHISPER] Transcribed: '{text[:150]}'")

        if not text:
            raise HTTPException(status_code=400, detail="No speech detected. Please speak clearly and try again.")

        return {
            "text":               text,
            "detected_language":  detected_language,
            "requested_language": language,
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"[WHISPER] Error: {e}")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass