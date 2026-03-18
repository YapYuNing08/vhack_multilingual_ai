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


# ── Language map ──────────────────────────────────────────────────────────────
LANG_MAP = {
    "en": "English",
    "ms": "Bahasa Malaysia",
    "zh": "Simplified Chinese (简体中文)",
    "ta": "Tamil (தமிழ்)",
    "id": "Bahasa Indonesia",
}


# ── IMPROVEMENT 3: LLM-based off-topic classifier ────────────────────────────
def is_off_topic(question: str, language: str = "en") -> tuple[bool, str]:
    """
    Use a fast LLM call to classify if the question is off-topic.
    Returns (is_blocked, polite_refusal_message).
    Much smarter than keyword matching — handles paraphrasing, dialects, etc.
    Uses a cheap/fast single-token classification first, then generates refusal.
    """
    client = _get_client()
    lang_name = LANG_MAP.get(language, "English")

    # Step 1: Binary classification (very fast, minimal tokens)
    classification = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a strict topic classifier for a Malaysian government public services chatbot. "
                    "Allowed topics: Malaysian government policies, public services, civic duties, legal matters, "
                    "healthcare, education, taxes, welfare, employment law, official documents, permits, licenses. "
                    "Reply with ONLY the word ALLOWED or BLOCKED. Nothing else."
                ),
            },
            {"role": "user", "content": question},
        ],
        temperature=0.0,
        max_tokens=5,
    )

    verdict = classification.choices[0].message.content.strip().upper()
    print(f"[Guard] Topic classification: '{verdict}' for: '{question}'")

    if "BLOCKED" not in verdict:
        return False, ""

    # Step 2: Generate a polite refusal in the correct language
    refusal = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    f"You are SilaSpeak, a friendly Malaysian public services assistant. "
                    f"The user asked something outside your scope. "
                    f"Write a SHORT, polite 1-2 sentence refusal in {lang_name} only. "
                    f"Tell them you only handle Malaysian government services and public policies. "
                    f"Do not answer their question. Do not use bullet points."
                ),
            },
            {"role": "user", "content": question},
        ],
        temperature=0.2,
        max_tokens=80,
    )

    refusal_text = refusal.choices[0].message.content.strip()
    return True, refusal_text


# ── Public API ────────────────────────────────────────────────────────────────
def generate_answer(
    question: str,
    context_chunks: list[str],
    language: str = "en",
    simplify: bool = True,
) -> str:
    """
    Generate a high-quality grounded answer with strict language lock,
    natural formatting, and graceful handling of weak/partial context.
    """
    client    = _get_client()
    lang_name = LANG_MAP.get(language, "English")

    # ── Build context block ────────────────────────────────────────────────
    if context_chunks:
        context_block = "\n\n---\n\n".join(context_chunks)
        context_quality = len(context_chunks)  # proxy for confidence
        grounding = f"<context>\n{context_block}\n</context>"
    else:
        context_quality = 0
        grounding = "<context>\nNo relevant documents found.\n</context>"

    # ── IMPROVEMENT 1: Tiered context instructions ─────────────────────────
    # Strong context (5+ chunks) → answer confidently from docs
    # Weak context (1–4 chunks)  → answer carefully, flag uncertainty
    # No context                 → use general knowledge, flag it clearly
    if context_quality >= 5:
        context_instruction = (
            "The context provided is comprehensive. "
            "Answer confidently and completely based on the context."
        )
    elif context_quality >= 1:
        context_instruction = (
            "The context is partial — it may not cover all aspects of the question. "
            "Answer what you can from the context, then clearly note any gaps "
            "and suggest the user verify with the relevant official authority."
        )
    else:
        context_instruction = (
            "No document context was found. "
            "Answer using your general knowledge about Malaysian public services, "
            "but clearly state that this is general guidance and not from an official document. "
            "Always recommend verifying with the official government website or agency."
        )

    simplify_instruction = (
        "Use simple, everyday language at a 5th-grade reading level. "
        "Avoid all legal and technical jargon. Use short sentences."
        if simplify else
        "Use clear, professional language appropriate for an educated adult."
    )

    # ── IMPROVEMENT 4: Natural bullet point formatting instruction ─────────
    format_instruction = (
        "Format your response naturally:\n"
        "- Start with 1-2 sentences directly answering the question.\n"
        "- Then provide key details as a short paragraph OR as bullet points — "
        "choose whichever feels more natural for this type of question.\n"
        "- End with a 'What you need to do' section with 3-5 clear action steps as bullets.\n"
        "- Do NOT use excessive headers or bold text everywhere.\n"
        "- Keep the total response concise — aim for under 300 words."
    )

    # ── IMPROVEMENT 2: Strict language lock with anti-contamination ────────
    system_prompt = f"""You are SilaSpeak, a friendly and trustworthy AI assistant for Malaysian public services.

════════════════════════════════════════════════
LANGUAGE LOCK — ABSOLUTE HIGHEST PRIORITY RULE:
Your output language is: {lang_name}
You MUST write every single word of your response in {lang_name}.
This rule overrides everything else, including the language of the context documents.
The <context> tags may contain text in a different language — you must READ it but TRANSLATE your answer into {lang_name}.
NEVER mix languages. NEVER switch mid-sentence. NEVER output the language name itself.
════════════════════════════════════════════════

CONTEXT CONFIDENCE: {context_instruction}

SIMPLIFICATION: {simplify_instruction}

FORMATTING: {format_instruction}

HONESTY RULE: Never fabricate facts, figures, dates, or eligibility criteria.
If you are unsure, say so and direct the user to the official source.

{grounding}"""

    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": question},
        ],
        temperature=0.15,  # Low = consistent, rule-following
        max_tokens=1024,
    )

    answer = response.choices[0].message.content.strip()

    print("\n" + "=" * 50)
    print(f"🗣️  QUESTION  : {question}")
    print(f"🌐 LANGUAGE  : {lang_name}")
    print(f"📄 CTX CHUNKS: {context_quality}")
    print(f"🤖 ANSWER    :\n{answer}")
    print("=" * 50 + "\n")

    return answer