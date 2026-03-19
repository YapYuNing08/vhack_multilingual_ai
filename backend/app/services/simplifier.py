from __future__ import annotations
from typing import Literal

ReadingLevel = Literal["simple", "moderate", "expert"]

LEVEL_INSTRUCTIONS: dict[ReadingLevel, str] = {
    "simple": (
        "Rewrite this for a general adult audience with no technical background. "
        "Use short sentences (max 20 words). Replace all jargon and legal terms with "
        "plain everyday words. Use active voice. Aim for a reading level of Grade 6."
    ),
    "moderate": (
        "Rewrite this in clear, plain language for an educated adult. "
        "Keep technical terms only when necessary, and explain them briefly. "
        "Use active voice and clear structure."
    ),
    "expert": (
        "Preserve the original meaning and technical accuracy. "
        "Lightly edit for clarity and conciseness without changing the register."
    ),
}


def simplify(text: str, level: ReadingLevel = "simple", language: str = "en") -> str:
    if not text.strip():
        return text

    from app.services.llm import _get_client, GROQ_MODEL
    from app.services.translate import get_language_name

    client = _get_client()
    lang   = get_language_name(language)
    instr  = LEVEL_INSTRUCTIONS.get(level, LEVEL_INSTRUCTIONS["simple"])

    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    f"{instr}\n\n"
                    f"Respond ONLY in {lang}. "
                    f"Do not add any explanations or preamble — output the rewritten text only."
                ),
            },
            {"role": "user", "content": text},
        ],
        temperature=0.2,
        max_tokens=1024,
    )
    return response.choices[0].message.content.strip()