import os
from groq import Groq

# ── Config ────────────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL   = os.getenv("GROQ_MODEL", "llama3-8b-8192")

_client: Groq | None = None


def _get_client() -> Groq:
    global _client
    if _client is None:
        if not GROQ_API_KEY:
            raise ValueError("GROQ_API_KEY is not set. Add it to your .env file.")
        _client = Groq(api_key=GROQ_API_KEY)
    return _client


# ── Language detection helper ─────────────────────────────────────────────────
def _detect_language(text: str) -> str:
    """
    Detect language from the user's message text directly.
    Returns a display name for the system prompt.
    Falls back to the passed language code if detection fails.
    """
    try:
        from langdetect import detect
        code = detect(text)
        mapping = {
            "en": "English",
            "ms": "Bahasa Malaysia",
            "id": "Bahasa Indonesia",
            "zh-cn": "Simplified Chinese",
            "zh-tw": "Traditional Chinese",
            "zh": "Simplified Chinese",
            "ta": "Tamil",
        }
        return mapping.get(code, "English")
    except Exception:
        return "English"

# ── Public API ────────────────────────────────────────────────────────────────
def generate_answer(
    question: str,
    context_chunks: list[str],
    language: str = "en",
    simplify: bool = True,
) -> str:
    client = _get_client()

    # Map the frontend language code to a full name for the prompt
    lang_map = {
        "en": "English",
        "ms": "Bahasa Malaysia",
        "zh": "Simplified Chinese",
        "ta": "Tamil",
        "id": "Bahasa Indonesia",
    }
    ui_language = lang_map.get(language, "English")

    # ── Build context block with XML tags ──────────────────────────────────
    if context_chunks:
        context_block = "\n\n---\n\n".join(context_chunks)
        grounding = f"<context>\n{context_block}\n</context>"
    else:
        grounding = "<context>\nNo document or web context found.\n</context>"

    simplify_instruction = (
        "Explain concepts at a 5th-grade reading level. Use simple, everyday words. Avoid jargon."
        if simplify else ""
    )

    # ── The Ultimate XML Prompt ────────────────────────────────────────────
    system_prompt = f"""
You are SilaSpeak, a strictly bounded AI assistant for Malaysian public services. 
You must evaluate the user's question by following these rules in exact order:

<rules>
1. LANGUAGE LOCK (CRITICAL PRIORITY):
   Identify the exact language or regional dialect of the user's question (e.g., Japanese, Manglish, Tagalog, English). You MUST write your ENTIRE response in this exact language/dialect. 

2. DOMAIN GUARDRAIL:
   Translate the question in your head. Is it about Malaysian government policies, public services, healthcare, education, or civic duties (like PTPTN, KWSP, visas, etc.)?
   - IF NO: Reply ONLY with a polite refusal stating you only handle Malaysian public service inquiries. (Ensure this refusal is in the language/dialect from Rule 1). DO NOT add anything else.

3. ZERO HALLUCINATION:
   Look at the text inside the <context> tags. Does it contain the specific information to answer the question?
   - IF NO: Reply ONLY stating that you cannot find the specific information in the provided documents. (Ensure this is in the language/dialect from Rule 1). DO NOT guess, DO NOT use external knowledge, and DO NOT make up steps.

4. TEXT SIMPLIFICATION & FORMAT:
   If the answer IS in the context, {simplify_instruction} 
   Always end your response with 3 to 5 clear bullet points summarising the action steps.
</rules>

{grounding}
"""

    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": question},
        ],
        temperature=0.1,   # Super low temperature for maximum rule obedience
        max_tokens=1024,
    )

    answer = response.choices[0].message.content.strip()

    print("\n" + "="*40)
    print(f"AI RESPONSE:")
    print(answer)
    print("="*40 + "\n")

    return answer