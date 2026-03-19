import os
from groq import Groq

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL   = os.getenv("GROQ_MODEL", "llama3-8b-8192")

_client: Groq | None = None

KNOWN_CATEGORIES = [
    "education", "health", "tax", "welfare", "housing",
    "employment", "legal", "transport", "environment", "general",
]


def _get_client() -> Groq:
    global _client
    if _client is None:
        if not GROQ_API_KEY:
            raise ValueError("GROQ_API_KEY is not set. Add it to your .env file.")
        _client = Groq(api_key=GROQ_API_KEY)
    return _client


def _detect_language_name(text: str) -> str:
    """Detect the language of the user's message via a tiny LLM call."""
    client = _get_client()
    result = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "Detect the language of the user's message. "
                    "Reply with ONLY the language name in English, nothing else. "
                    "Examples: 'English', 'Malay', 'Chinese', 'Tamil'. "
                    "If mixed, pick the dominant language."
                ),
            },
            {"role": "user", "content": text},
        ],
        temperature=0.0,
        max_tokens=10,
    )
    lang = result.choices[0].message.content.strip()
    print(f"[LLM] Detected language: '{lang}'")
    return lang


def detect_category(question: str) -> str | None:
    """LLaMA3 reads the question and returns one category word — the smart router."""
    client = _get_client()
    cats   = ", ".join(KNOWN_CATEGORIES)

    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    f"You are a document routing assistant. "
                    f"Given a user question, reply with ONLY ONE word from this list: {cats}. "
                    f"If unsure, reply: general. No explanation. No punctuation. One word only."
                ),
            },
            {"role": "user", "content": question},
        ],
        temperature=0.0,
        max_tokens=10,
    )

    raw      = response.choices[0].message.content.strip().lower()
    detected = raw if raw in KNOWN_CATEGORIES else None
    print(f"[LLM] Category detected: '{raw}' -> using: {detected}")
    return detected


def is_off_topic(question: str, language: str = "en") -> tuple[bool, str]:
    """Classifies whether the question is off-topic for a Malaysian public services chatbot."""
    client = _get_client()

    classification = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a strict topic classifier for a Malaysian government public services chatbot.\n\n"
                    "IMPORTANT: The user may write in ANY language. Understand the MEANING regardless of language.\n\n"
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
    print(f"[Guard] Topic classification: '{verdict}'")

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


def generate_answer(
    question:       str,
    context_chunks: list[str],
    language:       str  = "en",
    simplify:       bool = True,
    history:        list = [],
) -> str:
    """
    Generate a grounded answer in two steps:
    Step 1 - Answer in English (reliable, no language confusion)
    Step 2 - Translate to target language if needed
    """
    client = _get_client()

    if context_chunks:
        context_block = "\n\n---\n\n".join(context_chunks)
        grounding = (
            f"Use ONLY the following document excerpts to answer the question. "
            f"If the answer is not in the excerpts, say so clearly.\n\n"
            f"DOCUMENT EXCERPTS:\n{context_block}"
        )
    else:
        grounding = (
            "No relevant document has been uploaded yet. "
            "Answer based on general knowledge but remind the user to upload a document."
        )

    simplify_instruction = (
        "Use simple, everyday language. Avoid jargon. Short sentences. 5th-grade reading level."
        if simplify else "Use clear, professional language."
    )

    system_prompt = f"""You are SilaSpeak, a helpful AI assistant for Malaysian citizens.
Answer questions based ONLY on the provided document excerpts.

RULES:
1. SIMPLIFICATION: {simplify_instruction}
2. ACTIONABLE FORMAT: End your answer with 3-5 bullet points of what the user needs to know or do.
3. HONESTY: If the answer is not in the context, say: "I couldn't find that in the uploaded documents."
4. MEMORY: Use conversation history for follow-up questions.

{grounding}"""

    # Build messages with history
    messages = [{"role": "system", "content": system_prompt}]
    for msg in history:
        role    = msg.role if hasattr(msg, "role") else msg.get("role", "user")
        content = msg.content if hasattr(msg, "content") else msg.get("content", "")
        messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": question})

    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=messages,
        temperature=0.3,
        max_tokens=1024,
    )
    answer = response.choices[0].message.content.strip()

    # Step 2: Translate if not English
    if language != "en":
        lang_map = {
            "ms": "Bahasa Malaysia",
            "zh": "Simplified Chinese",
            "ta": "Tamil",
            "id": "Bahasa Indonesia",
        }
        lang_name = lang_map.get(language, "English")

        translate_response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        f"You are a professional translator. "
                        f"Translate the following text into {lang_name}. "
                        f"Preserve all bullet points, formatting and meaning exactly. "
                        f"Output ONLY the translated text. Nothing else."
                    ),
                },
                {"role": "user", "content": answer},
            ],
            temperature=0.1,
            max_tokens=1024,
        )
        answer = translate_response.choices[0].message.content.strip()

    print("\n" + "="*40)
    print("FINAL ANSWER:")
    print(answer)
    print("="*40 + "\n")

    return answer