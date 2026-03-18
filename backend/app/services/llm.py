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


# ── Detect language of a text string ─────────────────────────────────────────
def _detect_language_name(text: str) -> str:
    """
    Detect the language of the user's question via a tiny LLM call.
    Returns a plain English language name e.g. 'Japanese', 'Malay', 'English'.
    """
    client = _get_client()
    result = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "Detect the language of the user's message. "
                    "Reply with ONLY the language name in English, nothing else. "
                    "Examples: 'English', 'Malay', 'Japanese', 'Chinese', 'Tamil', 'Arabic', 'Korean'. "
                    "If mixed, pick the dominant language."
                ),
            },
            {"role": "user", "content": text},
        ],
        temperature=0.0,
        max_tokens=10,
    )
    lang = result.choices[0].message.content.strip()
    print(f"[LLM] Detected language: '{lang}' for: '{text[:60]}'")
    return lang


# ── Off-topic classifier ──────────────────────────────────────────────────────
def is_off_topic(question: str, language: str = "en") -> tuple[bool, str]:
    """
    Classifies whether the question is off-topic.
    NOTE: Short follow-up questions like "what if I'm under 13?" should be
    evaluated with conversation history in mind — the classifier sees only
    the current message, so we keep this deliberately permissive.
    """
    client = _get_client()

    classification = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a strict topic classifier for a Malaysian government public services chatbot.\n\n"
                    "IMPORTANT: The user may write in ANY language. "
                    "Understand the MEANING regardless of language.\n\n"
                    "IMPORTANT: Short follow-up questions like 'what if I am not?', 'how about children?', "
                    "'and if I am under 18?' are likely continuations of a civic conversation — mark them ALLOWED.\n\n"
                    "ALLOWED topics: Malaysian government policies, public services, civic duties, "
                    "legal matters, healthcare, education, taxes, welfare, employment law, "
                    "official documents, permits, licenses, scholarships, loans, driving license, passport.\n\n"
                    "BLOCKED topics: celebrities, entertainment, recipes, sports, gaming, "
                    "general knowledge clearly unrelated to Malaysian public services.\n\n"
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

    detected_lang = _detect_language_name(question)
    refusal = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    f"You are SilaSpeak, a friendly Malaysian public services assistant. "
                    f"The user asked something outside your scope. "
                    f"Write a SHORT, polite 1-2 sentence refusal in {detected_lang} only. "
                    f"Tell them you only handle Malaysian government services and public policies. "
                    f"Do not answer their question. Do not use bullet points."
                ),
            },
            {"role": "user", "content": question},
        ],
        temperature=0.2,
        max_tokens=80,
    )

    return True, refusal.choices[0].message.content.strip()


# ── Answer generator ──────────────────────────────────────────────────────────
def generate_answer(
    question: str,
    context_chunks: list[str],
    language: str = "en",
    simplify: bool = True,
    history: list[dict] | None = None,  # ✅ NEW: conversation history
) -> str:
    """
    Generate a grounded answer with full conversation memory.

    Args:
        question:       Current user question.
        context_chunks: RAG-retrieved chunks relevant to current question.
        language:       UI language code (used as fallback only).
        simplify:       Whether to simplify language.
        history:        List of prior turns: [{"role": "user"|"assistant", "content": "..."}]
                        Pass the last 6 messages (3 turns) for best results.
    """
    client = _get_client()

    # ── Detect language from current question ─────────────────────────────
    detected_lang = _detect_language_name(question)

    # ── Build context block ────────────────────────────────────────────────
    context_quality = len(context_chunks)

    if context_chunks:
        context_block = "\n\n---\n\n".join(context_chunks)
        grounding = f"<context>\n{context_block}\n</context>"
    else:
        grounding = "<context>\nNo relevant documents found.\n</context>"

    # ── Tiered confidence ──────────────────────────────────────────────────
    if context_quality >= 5:
        context_instruction = (
            "The context is comprehensive. Answer confidently and completely from the context. "
            "Do NOT add information not in the context."
        )
    elif context_quality >= 1:
        context_instruction = (
            "The context is partial. Answer ONLY what is explicitly supported. "
            "Do NOT guess or fill gaps. Clearly state missing details and direct the user to the official source."
        )
    else:
        context_instruction = (
            "No document context found. Use only well-established facts about Malaysian public services. "
            "Clearly state this is general guidance. Always recommend verifying with the official source. "
            "If unsure of a fact, say so — do not guess."
        )

    simplify_instruction = (
        "Use simple, everyday language. Avoid legal and technical jargon. Use short sentences."
        if simplify else "Use clear, professional language."
    )

    system_prompt = f"""You are SilaSpeak, a trustworthy AI assistant for Malaysian public services.

════════════════════════════════════════════════
LANGUAGE LOCK — NON-NEGOTIABLE HIGHEST PRIORITY:
The user's question is written in: {detected_lang}
You MUST write your ENTIRE response in {detected_lang}.
Every word, bullet point, and heading — ALL in {detected_lang}.
The <context> may be in a different language — read it, but reply in {detected_lang}.
DO NOT reply in English unless the question is in English.
DO NOT mix languages.
════════════════════════════════════════════════

CONVERSATION MEMORY:
You have access to the recent conversation history below.
Use it to understand follow-up questions and references like "what if I'm not?",
"what about children?", "and for foreigners?" — resolve these using prior context.
Always maintain continuity with what was previously discussed.

ANTI-HALLUCINATION:
{context_instruction}
Never invent eligibility rules, amounts, dates, or procedures.
If context says something is NOT allowed, state that clearly without softening it.

SIMPLIFICATION: {simplify_instruction}

FORMATTING:
- Start with 1-2 sentences directly answering the question.
- Provide supporting details as short paragraphs or bullets.
- End with a 'What you need to do' section with 3-5 action steps as bullets.
- Keep total response under 300 words.

{grounding}"""

    # ── Build message list with history ───────────────────────────────────
    # Structure: [system] + [history turns...] + [current user question]
    messages = [{"role": "system", "content": system_prompt}]

    if history:
        # Inject last N turns (already sliced to 6 in frontend/chat.py)
        for turn in history:
            if turn.get("role") in ("user", "assistant") and turn.get("content"):
                messages.append({"role": turn["role"], "content": turn["content"]})

    # Add current question last
    messages.append({"role": "user", "content": question})

    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=messages,
        temperature=0.1,
        max_tokens=1024,
    )

    answer = response.choices[0].message.content.strip()

    print("\n" + "=" * 50)
    print(f"🗣️  QUESTION  : {question}")
    print(f"🌐 DETECTED  : {detected_lang}")
    print(f"📄 CTX CHUNKS: {context_quality}")
    print(f"🕘 HISTORY   : {len(history or [])} turns")
    print(f"🤖 ANSWER    :\n{answer}")
    print("=" * 50 + "\n")

    return answer