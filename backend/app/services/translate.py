"""
translate.py
------------
Lightweight translation helper for SilaSpeak.

Strategy:
  - Translation is handled DIRECTLY by the LLM (llm.py) via the system prompt
    ("always respond in <language>"). This is the cleanest approach for a
    hackathon — no extra API keys, no rate limits, better quality.

  - This module provides:
      1. Language validation / display name lookup
      2. A detect_language() helper (uses langdetect, free)
      3. A standalone translate() fallback for cases where you need
         translation OUTSIDE of an LLM call (e.g. translating a document
         summary without a user question).

Usage:
    from services.translate import SUPPORTED_LANGUAGES, translate, detect_language
"""

from __future__ import annotations

# ── Supported Languages ───────────────────────────────────────────────────────
SUPPORTED_LANGUAGES: dict[str, str] = {
    "en": "English",
    "ms": "Bahasa Malaysia",
    "zh": "Simplified Chinese",
    "ta": "Tamil",
    "id": "Bahasa Indonesia",
}


def get_language_name(code: str) -> str:
    """Return the display name for a language code, defaulting to English."""
    return SUPPORTED_LANGUAGES.get(code.lower(), "English")


def is_supported(code: str) -> bool:
    return code.lower() in SUPPORTED_LANGUAGES


# ── Language Detection ────────────────────────────────────────────────────────
def detect_language(text: str) -> str:
    """
    Detect the language of a text string.
    Returns a language code (e.g. 'en', 'ms').
    Falls back to 'en' if detection fails.

    Requires: pip install langdetect
    """
    try:
        from langdetect import detect
        code = detect(text)
        # langdetect returns 'zh-cn' — normalise to 'zh'
        if code.startswith("zh"):
            return "zh"
        return code if code in SUPPORTED_LANGUAGES else "en"
    except Exception:
        return "en"


# ── Standalone Translation (fallback) ─────────────────────────────────────────
def translate(text: str, target_language: str) -> str:
    """
    Translate text to the target language using the Groq LLM.
    Use this only when you need translation WITHOUT a RAG query
    (e.g. translating a document title or a system message).

    For regular chat answers, translation is handled inside llm.generate_answer().
    """
    if not text.strip():
        return text

    target_name = get_language_name(target_language)
    if target_language == "en" or target_language not in SUPPORTED_LANGUAGES:
        return text   # no translation needed

    from services.llm import _get_client, GROQ_MODEL  # lazy import to avoid circular
    client = _get_client()

    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    f"You are a professional translator. "
                    f"Translate the following text into {target_name}. "
                    f"Return ONLY the translated text, no explanations, no preamble."
                ),
            },
            {"role": "user", "content": text},
        ],
        temperature=0.1,
        max_tokens=1024,
    )

    return response.choices[0].message.content.strip()