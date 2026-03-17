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

# ── Public API ────────────────────────────────────────────────────────────────
def generate_answer(
    question: str,
    context_chunks: list[str],
    language: str = "en",
    simplify: bool = True,
) -> str:
    client = _get_client()

    lang_map = {
        "en": "English",
        "ms": "Bahasa Malaysia",
        "zh": "Simplified Chinese",
        "ta": "Tamil",
        "id": "Bahasa Indonesia",
    }
    ui_language = lang_map.get(language, "English")

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
        Identify the exact language or regional dialect of the user's question. You MUST write your ENTIRE response in this exact language/dialect. 
        - DO NOT print the name of the language (e.g., do not print "Bahasa Malaysia:").
        - DO NOT print "Translation:" or include the original English text. Just output the final translated text.
        - If the user's language is too short to determine, default to {ui_language}.

        2. DOMAIN GUARDRAIL:
        Translate the question in your head. Is it about Malaysian government policies, public services, healthcare, education, or civic duties?
        - IF NO: Reply ONLY with: "I am sorry, but I only handle inquiries related to Malaysian public services and government policies." (Translated into the user's language). DO NOT add bullet points. DO NOT add action steps. STOP IMMEDIATELY.

        3. ZERO HALLUCINATION & FORMATTING:
        Look at the text inside the <context> tags. Does it contain the specific information to answer the question?
        - IF NO: Reply ONLY with: "I cannot find the specific information to answer your question in the provided documents." (Translated into the user's language). DO NOT guess. DO NOT give advice. DO NOT add bullet points. DO NOT add action steps. STOP IMMEDIATELY.
        - IF YES: 
            - {simplify_instruction}
            - You MUST end your response with 3 to 5 clear bullet points summarising the action steps.
        </rules>

        {grounding}
        """

    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": question},
        ],
        temperature=0.1,
        max_tokens=1024,
    )

    answer = response.choices[0].message.content.strip()
    
    # ── Terminal Debugging ────────────────────────────────────────────────
    print("\n" + "="*50)
    print(f"🗣️  USER QUESTION:\n{question}")
    print("-" * 50)
    print(f"🤖 AI RESPONSE:\n{answer}")
    print("="*50 + "\n")
    
    return answer