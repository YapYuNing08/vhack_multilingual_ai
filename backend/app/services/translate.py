from __future__ import annotations

SUPPORTED_LANGUAGES: dict[str, str] = {
    "en": "English",
    "ms": "Bahasa Malaysia",
    "zh": "Simplified Chinese",
    "ta": "Tamil",
    "id": "Bahasa Indonesia",
}


def get_language_name(code: str) -> str:
    return SUPPORTED_LANGUAGES.get(code.lower(), "English")


def is_supported(code: str) -> bool:
    return code.lower() in SUPPORTED_LANGUAGES


def detect_language(text: str) -> str:
    try:
        from langdetect import detect
        code = detect(text)
        if code.startswith("zh"):
            return "zh"
        return code if code in SUPPORTED_LANGUAGES else "en"
    except Exception:
        return "en"


def translate(text: str, target_language: str) -> str:
    if not text.strip():
        return text
    target_name = get_language_name(target_language)
    if target_language == "en" or target_language not in SUPPORTED_LANGUAGES:
        return text

    from app.services.llm import _get_client, GROQ_MODEL
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