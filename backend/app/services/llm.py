import os
import re
from groq import Groq

# ── Config ────────────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL   = os.getenv("GROQ_MODEL", "llama3-8b-8192")

_client: Groq | None = None

VALID_LANGUAGES = {
    "english", "malay", "bahasa malaysia", "chinese", "mandarin",
    "simplified chinese", "traditional chinese",
    "tamil", "japanese", "korean", "arabic", "french", "spanish",
    "indonesian", "bahasa indonesia", "hindi", "thai", "vietnamese",
    "burmese", "khmer", "tagalog", "filipino",
}


def _get_client() -> Groq:
    global _client
    if _client is None:
        if not GROQ_API_KEY:
            raise ValueError("GROQ_API_KEY is not set.")
        _client = Groq(api_key=GROQ_API_KEY)
    return _client


# ── Debug printer ─────────────────────────────────────────────────────────────
def _debug(question: str, answer: str, detected_lang: str, ctx: int,
           jargon: list, scam_alert: dict | None, urls: list):
    SEP  = "─" * 60
    SEP2 = "═" * 60
    print(f"\n{SEP2}")
    print(f"  🗣  QUESTION")
    print(f"{SEP}")
    for line in question.splitlines():
        print(f"  {line}")
    print(f"{SEP}")
    print(f"  🌐 Language : {detected_lang}")
    print(f"  📄 Context  : {ctx} chunk(s)")
    if urls:
        print(f"  🔗 URLs     : {len(urls)} removed (scam protection)")
    if scam_alert:
        print(f"  🚨 Scam     : {scam_alert.get('risk_level','?')} — {scam_alert.get('warning','')[:60]}")
    if jargon:
        print(f"  📖 Jargon   : {', '.join(jargon)}")
    print(f"{SEP}")
    print(f"  🤖  ANSWER")
    print(f"{SEP}")
    for line in answer.splitlines():
        print(f"  {line}")
    print(f"{SEP2}\n")


# ── URL sanitizer ─────────────────────────────────────────────────────────────
def _sanitize_input(text: str) -> tuple[str, list[str]]:
    url_pattern = re.compile(
        r'http[s]?://(?:[a-zA-Z]|[0-9]|[$\-_@.&+]|[!*\\(\\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+'
    )
    urls_found = url_pattern.findall(text)
    sanitized  = url_pattern.sub("[LINK REMOVED FOR SAFETY]", text)
    return sanitized, urls_found


# ── Script-based language detection ──────────────────────────────────────────
def _script_detect(text: str) -> str | None:
    """Fast Unicode-block detection for non-Latin scripts."""
    scores = {
        "Chinese":  len(re.findall(r'[\u4e00-\u9fff\u3400-\u4dbf]', text)),
        "Japanese": len(re.findall(r'[\u3040-\u309f\u30a0-\u30ff]', text)),
        "Korean":   len(re.findall(r'[\uac00-\ud7af]', text)),
        "Arabic":   len(re.findall(r'[\u0600-\u06ff]', text)),
        "Tamil":    len(re.findall(r'[\u0b80-\u0bff]', text)),
        "Thai":     len(re.findall(r'[\u0e00-\u0e7f]', text)),
    }
    dominant = max(scores, key=scores.get)
    return dominant if scores[dominant] > 0 else None


def _detect_language_name(text: str) -> str:
    """Detect language of the CURRENT user message only."""
    sanitized, _ = _sanitize_input(text)
    sample = sanitized[:150].strip()
    if not sample:
        return "English"

    # Non-Latin script detection (free, instant)
    script_result = _script_detect(sample)
    if script_result:
        print(f"  [Lang] Script detected: {script_result}")
        return script_result

    # Latin-script: use LLM
    client = _get_client()
    result = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "Detect the language of the user's message. "
                    "Focus on the LAST sentence or question the user wrote — not any quoted text or SMS content they are asking about. "
                    "Output ONLY a single language name. No sentences. No punctuation. 1-2 words max. "
                    "Examples: English, Malay, Indonesian, Filipino, Vietnamese. "
                    "If unclear, output: English"
                ),
            },
            {"role": "user", "content": sample},
        ],
        temperature=0.0,
        max_tokens=8,
    )

    raw = result.choices[0].message.content.strip()
    if len(raw.split()) > 3 or raw.lower() not in VALID_LANGUAGES:
        print(f"  [Lang] Fallback: '{raw}' → English")
        return "English"

    print(f"  [Lang] LLM detected: {raw}")
    return raw


# ── Post-generation translation ───────────────────────────────────────────────
def _translate_answer(answer: str, target_lang: str) -> str:
    """
    Translate the generated answer into the target language.
    This is a guaranteed fallback — even if the LLM ignores the language lock
    during generation, we translate the output afterwards.
    Only runs if the answer appears to be in the wrong language.
    """
    client = _get_client()

    # Quick check: detect what language the answer is actually in
    answer_lang = _detect_language_name(answer[:200])

    # Normalise for comparison
    def normalise(lang: str) -> str:
        lang = lang.lower()
        if lang in ("bahasa malaysia", "malay"):
            return "malay"
        if lang in ("simplified chinese", "traditional chinese", "mandarin", "chinese"):
            return "chinese"
        if lang in ("bahasa indonesia", "indonesian"):
            return "indonesian"
        return lang

    if normalise(answer_lang) == normalise(target_lang):
        return answer  # already correct language, no translation needed

    print(f"  [Lang] ⚠️  Answer in '{answer_lang}' but expected '{target_lang}' — translating...")

    result = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    f"You are a professional translator. "
                    f"Translate the following text into {target_lang}. "
                    f"Preserve all formatting, bullet points, and structure exactly. "
                    f"Return ONLY the translated text. No explanations, no preamble."
                ),
            },
            {"role": "user", "content": answer},
        ],
        temperature=0.1,
        max_tokens=1024,
    )

    translated = result.choices[0].message.content.strip()
    print(f"  [Lang] ✅ Translation complete → {target_lang}")
    return translated


# ── Scam detector ─────────────────────────────────────────────────────────────
def _detect_scam_in_text(text: str) -> dict:
    client = _get_client()
    result = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a Malaysian scam detector. Check for:\n"
                    "- Links to unofficial domains (not .gov.my)\n"
                    "- Requests for bank account, password, IC number\n"
                    "- Urgency tactics ('claim today', 'expires tonight')\n"
                    "- Impersonation of LHDN, PDRM, EPF, STR, PTPTN\n"
                    "- Promises of sudden cash via a link\n\n"
                    "Reply ONLY with JSON (no markdown):\n"
                    '{"is_scam": true/false, "risk_level": "HIGH"|"MEDIUM"|"LOW"|"SAFE", '
                    '"warning": "One sentence warning in the same language as the message."}'
                ),
            },
            {"role": "user", "content": text},
        ],
        temperature=0.0,
        max_tokens=120,
    )
    raw = result.choices[0].message.content.strip()
    try:
        import json
        return json.loads(raw.replace("```json", "").replace("```", "").strip())
    except Exception:
        return {"is_scam": False, "risk_level": "SAFE", "warning": ""}


# ── Jargon extractor ──────────────────────────────────────────────────────────
def extract_jargon(answer: str, detected_lang: str) -> dict[str, str]:
    client = _get_client()
    result = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    f"Identify government jargon in this text that an elderly person might not understand. "
                    f"Examples: B40, PTPTN, MyKad, EPF, SOCSO, CGPA, subsidised, eligible, means-tested.\n\n"
                    f"For each term, give a 1-sentence plain explanation in {detected_lang}.\n\n"
                    f"Reply ONLY with JSON (no markdown): "
                    f'{{ "TERM": "explanation in {detected_lang}" }}\n'
                    f"If none found, return: {{}}"
                ),
            },
            {"role": "user", "content": answer},
        ],
        temperature=0.1,
        max_tokens=512,
    )
    raw = result.choices[0].message.content.strip()
    try:
        import json
        jargon_map   = json.loads(raw.replace("```json", "").replace("```", "").strip())
        answer_lower = answer.lower()
        return {k: v for k, v in jargon_map.items() if k.lower() in answer_lower}
    except Exception:
        return {}


# ── Off-topic classifier ──────────────────────────────────────────────────────
def is_off_topic(question: str, language: str = "en") -> tuple[bool, str]:
    client = _get_client()
    sanitized, _ = _sanitize_input(question)

    classification = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    "Topic classifier for a Malaysian government public services chatbot.\n"
                    "Understand MEANING regardless of language or script.\n"
                    "Short follow-up questions ('what if I am not?', 'how about children?') → ALLOWED.\n"
                    "Messages with suspicious links asking 'what is this?' → ALLOWED.\n"
                    "ALLOWED: government policies, public services, healthcare, education, taxes, "
                    "welfare, employment law, documents, permits, licenses, scholarships, loans, passport, scam verification.\n"
                    "BLOCKED: celebrities, entertainment, recipes, sports, gaming, unrelated trivia.\n"
                    "Reply ONLY: ALLOWED or BLOCKED."
                ),
            },
            {"role": "user", "content": sanitized},
        ],
        temperature=0.0,
        max_tokens=5,
    )

    verdict = classification.choices[0].message.content.strip().upper()
    print(f"  [Guard] {'🚫 BLOCKED' if 'BLOCKED' in verdict else '✅ ALLOWED'}: {question[:60]}")

    if "BLOCKED" not in verdict:
        return False, ""

    detected_lang = _detect_language_name(question)
    refusal = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {
                "role": "system",
                "content": (
                    f"You are SilaSpeak. Write a SHORT polite 1-2 sentence refusal in {detected_lang}. "
                    f"Tell them you only handle Malaysian government services. No bullet points."
                ),
            },
            {"role": "user", "content": sanitized},
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
    history: list[dict] | None = None,
) -> dict:
    client = _get_client()

    sanitized_question, removed_urls = _sanitize_input(question)
    has_suspicious_url = len(removed_urls) > 0

    # Detect language from CURRENT question only
    detected_lang = _detect_language_name(sanitized_question)

    scam_alert = None
    if has_suspicious_url:
        scam_check = _detect_scam_in_text(question)
        if scam_check.get("risk_level") in ("HIGH", "MEDIUM"):
            scam_alert = scam_check

    context_quality = len(context_chunks)
    if context_chunks:
        context_block = "\n\n---\n\n".join(context_chunks)
        grounding = f"<context>\n{context_block}\n</context>"
    else:
        grounding = "<context>\nNo relevant documents found.\n</context>"

    if context_quality >= 5:
        context_instruction = "Context is comprehensive. Answer confidently. Do NOT add info not in context."
    elif context_quality >= 1:
        context_instruction = "Context is partial. Answer ONLY what is explicitly supported. Flag gaps."
    else:
        context_instruction = (
            "No document context. Use only well-established facts about Malaysian public services. "
            "State this is general guidance."
        )

    simplify_instruction = (
        "Use simple, everyday language. Short sentences."
        if simplify else "Use clear, professional language."
    )

    scam_instruction = ""
    if has_suspicious_url or scam_alert:
        scam_instruction = """
SCAM SAFETY OVERRIDE — CRITICAL — OVERRIDES ALL OTHER INSTRUCTIONS:
1. NEVER tell the user to click any link or provide bank/personal details.
2. NEVER repeat any URL from the user's message.
3. ONLY warn the user and give safe OFFLINE verification steps:
   - Call the official agency hotline directly
   - Visit the official .gov.my website by typing it manually
   - Visit the nearest physical office in person
   - Report to CyberSecurity Malaysia: 1-300-88-2999
4. Action steps must contain ZERO mentions of clicking links.
"""

    system_prompt = f"""You are SilaSpeak, a trustworthy AI assistant for Malaysian public services.

LANGUAGE: Reply in {detected_lang}. Every word. No exceptions.
Context and history may be in other languages — ignore their language, use {detected_lang} only.
{scam_instruction}
MEMORY: Use history to understand what the user is asking, not to decide reply language.
ANTI-HALLUCINATION: {context_instruction}
SIMPLIFICATION: {simplify_instruction}
FORMAT: 1-2 direct sentences first. Details as bullets. End with 'What you need to do' (3-5 steps). Max 300 words.
{grounding}"""

    messages = [{"role": "system", "content": system_prompt}]
    if history:
        for turn in history:
            if turn.get("role") in ("user", "assistant") and turn.get("content"):
                messages.append({"role": turn["role"], "content": turn["content"]})
    messages.append({
        "role": "system",
        "content": f"FINAL REMINDER: Respond in {detected_lang} only. Not Malay. Not English. {detected_lang}."
    })
    messages.append({"role": "user", "content": sanitized_question})

    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=messages,
        temperature=0.1,
        max_tokens=1024,
    )

    answer = response.choices[0].message.content.strip()

    # ✅ Guaranteed language correction — translate if LLM replied in wrong language
    answer = _translate_answer(answer, detected_lang)

    jargon_map = extract_jargon(answer, detected_lang)

    _debug(
        question=question, answer=answer, detected_lang=detected_lang,
        ctx=context_quality, jargon=list(jargon_map.keys()),
        scam_alert=scam_alert, urls=removed_urls,
    )

    return {
        "reply":      answer,
        "jargon":     jargon_map,
        "scam_alert": scam_alert,
    }