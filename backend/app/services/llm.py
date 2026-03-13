import os
from groq import Groq

# ── Config ────────────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY")          # set in your .env
GROQ_MODEL   = os.getenv("GROQ_MODEL", "llama3-8b-8192")   # fast + free tier

_client: Groq | None = None


def _get_client() -> Groq:
    global _client
    if _client is None:
        if not GROQ_API_KEY:
            raise ValueError("GROQ_API_KEY is not set. Add it to your .env file.")
        _client = Groq(api_key=GROQ_API_KEY)
    return _client


# ── Public API ────────────────────────────────────────────────────────────────
def generate_answer(
    question: str,
    context_chunks: list[str],
    language: str = "en",
    simplify: bool = True,
) -> str:
    """
    Generate a grounded answer using retrieved context chunks.

    Args:
        question:       The user's question.
        context_chunks: Relevant passages retrieved from ChromaDB.
        language:       Target language code (e.g. "ms", "zh", "ta", "en").
        simplify:       If True, ask the model to use plain, simple language.

    Returns:
        The model's answer as a plain string.
    """
    client = _get_client()

    # ── Build context block ────────────────────────────────────────────────
    if context_chunks:
        context_block = "\n\n---\n\n".join(context_chunks)
        grounding = (
            f"Use ONLY the following document excerpts to answer the question. "
            f"If the answer cannot be found in the excerpts, say so clearly.\n\n"
            f"DOCUMENT EXCERPTS:\n{context_block}"
        )
    else:
        grounding = (
            "No document has been uploaded yet. "
            "Answer based on your general knowledge but remind the user to upload a document for accurate answers."
        )

    # ── Language instruction ───────────────────────────────────────────────
    lang_map = {
        "en": "English",
        "ms": "Bahasa Malaysia",
        "zh": "Simplified Chinese (简体中文)",
        "ta": "Tamil (தமிழ்)",
        "id": "Bahasa Indonesia",
    }
    lang_name = lang_map.get(language, "English")

    simplify_instruction = (
        "Use simple, everyday language that a person with no technical or legal background can understand. "
        "Avoid jargon. Break down complex ideas into short sentences."
        if simplify
        else ""
    )

    system_prompt = (
        f"You are SilaSpeak, a helpful AI assistant that explains official government documents "
        f"and public services to everyday citizens in ASEAN.\n\n"
        f"{grounding}\n\n"
        f"IMPORTANT INSTRUCTIONS:\n"
        f"- Always respond in {lang_name}.\n"
        f"- {simplify_instruction}\n"
        f"- Be concise. Answer the question directly.\n"
        f"- If citing information, mention the source document naturally."
    )

    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": question},
        ],
        temperature=0.3,     # low = factual, consistent
        max_tokens=1024,
    )

    return response.choices[0].message.content.strip()