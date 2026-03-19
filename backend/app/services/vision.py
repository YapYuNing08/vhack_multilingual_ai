import base64
import os
import json
from groq import Groq

VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"

LANG_MAP = {
    "en": "English", "ms": "Bahasa Malaysia",
    "zh": "Simplified Chinese", "ta": "Tamil", "id": "Bahasa Indonesia",
}


def analyze_document_image(image_bytes: bytes, language: str) -> dict:
    base64_image = base64.b64encode(image_bytes).decode('utf-8')
    # ✅ ui_language is the user's chosen language — used for jargon explanations too
    ui_language  = LANG_MAP.get(language, "English")

    client = Groq(api_key=os.environ.get("GROQ_API_KEY"))

    # ── Step 1: Scam detection first ──────────────────────────────────────
    scam_prompt = """
You are a Malaysian government document fraud expert and scam detector.
Examine this document image for signs of fraud or scams.

RED FLAGS:
- Requests for bank account numbers, PINs, or passwords
- Unofficial contact methods (personal WhatsApp, Gmail addresses)
- Threats of immediate arrest, fine, or account suspension
- Urgency pressure tactics ("respond within 24 hours")
- Unofficial logos, poor formatting, spelling errors
- Requests to click suspicious links or scan unknown QR codes
- Impersonation of LHDN, PDRM, Bank Negara, EPF, SOCSO
- Requests for payment via crypto, gift cards, personal transfers
- Links to non-.gov.my domains

Respond ONLY with valid JSON (no markdown):
{
  "is_scam": true/false,
  "risk_level": "HIGH" | "MEDIUM" | "LOW" | "SAFE",
  "red_flags": ["flag1", "flag2"],
  "verdict": "One sentence summary of the fraud assessment"
}
"""

    print(f"\n[Vision] 🔍 Analyzing document with {VISION_MODEL}...")

    try:
        scam_response = client.chat.completions.create(
            model=VISION_MODEL,
            messages=[{"role": "user", "content": [
                {"type": "text",      "text": scam_prompt},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}}
            ]}],
            temperature=0.0,
            max_tokens=512,
        )

        scam_raw = scam_response.choices[0].message.content.strip()
        try:
            scam_result = json.loads(scam_raw.replace("```json", "").replace("```", "").strip())
        except json.JSONDecodeError:
            scam_result = {
                "is_scam": False, "risk_level": "UNKNOWN",
                "red_flags": [], "verdict": "Could not perform fraud analysis."
            }

        is_high_risk = scam_result.get("risk_level") in ("HIGH", "MEDIUM")

        # ── Step 2: Explanation ───────────────────────────────────────────
        if is_high_risk:
            action_instruction = """
⚠️ SCAM SAFETY OVERRIDE:
1. WARN the user this looks like a scam.
2. Tell them NOT to click any links, NOT to provide bank details.
3. Give ONLY safe offline steps:
   - Call official agency hotline (LHDN: 03-8911 1000, PDRM: 999, BNM: 1-300-88-5465)
   - Visit the official .gov.my website by typing it manually
   - Visit the nearest physical office in person
   - Report to CyberSecurity Malaysia: 1-300-88-2999
"""
        else:
            action_instruction = "Provide normal actionable steps based on the document content."

        explain_prompt = f"""
You are SilaSpeak, an AI helping Malaysian citizens understand government letters and notices.

1. Identify who sent it (e.g., LHDN, JPJ, Hospital, Ministry).
2. Extract any important dates, deadlines, or appointment times.
3. Explain the main purpose in very simple, 5th-grade terms.
4. Actionable steps: {action_instruction}

CRITICAL: Write your ENTIRE response in {ui_language}.
"""

        explain_response = client.chat.completions.create(
            model=VISION_MODEL,
            messages=[{"role": "user", "content": [
                {"type": "text",      "text": explain_prompt},
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}}
            ]}],
            temperature=0.1,
            max_tokens=1024,
        )

        explanation = explain_response.choices[0].message.content.strip()

        # ── Step 3: Jargon in user's language ────────────────────────────
        jargon_map = _extract_jargon_vision(explanation, ui_language)

        _debug_vision(explanation, scam_result, jargon_map)

        return {
            "explanation": explanation,
            "scam_result": scam_result,
            "jargon":      jargon_map,
        }

    except Exception as e:
        print(f"[Vision] ❌ Error: {e}")
        return {
            "explanation": f"Sorry, I encountered an error: {str(e)}",
            "scam_result": {
                "is_scam": False, "risk_level": "UNKNOWN",
                "red_flags": [], "verdict": "Fraud analysis unavailable."
            },
            "jargon": {},
        }


def _extract_jargon_vision(explanation: str, language: str) -> dict[str, str]:
    """Extract jargon with explanations in the user's language."""
    try:
        client = Groq(api_key=os.environ.get("GROQ_API_KEY"))
        result = client.chat.completions.create(
            model=VISION_MODEL,
            messages=[{"role": "user", "content": (
                f"Identify government jargon in this text that an elderly person might not understand. "
                f"Examples: LHDN, MyKad, EPF, SOCSO, cukai, subsidised, eligible.\n\n"
                # ✅ Explanations in the user's selected language
                f"For each term, give a 1-sentence plain explanation in {language}.\n\n"
                f"Reply ONLY with JSON (no markdown): "
                f'{{ "TERM": "explanation in {language}" }}\n'
                f"If none found, return: {{}}\n\nTEXT:\n{explanation}"
            )}],
            temperature=0.1,
            max_tokens=512,
        )
        raw        = result.choices[0].message.content.strip()
        jargon_map = json.loads(raw.replace("```json", "").replace("```", "").strip())
        lower      = explanation.lower()
        return {k: v for k, v in jargon_map.items() if k.lower() in lower}
    except Exception as e:
        print(f"[Vision] Jargon extraction failed: {e}")
        return {}


def _debug_vision(explanation: str, scam_result: dict, jargon: dict):
    SEP  = "─" * 60
    SEP2 = "═" * 60
    risk  = scam_result.get("risk_level", "?")
    emoji = {"HIGH": "🚨", "MEDIUM": "⚠️", "LOW": "🔍", "SAFE": "✅"}.get(risk, "❓")

    print(f"\n{SEP2}")
    print(f"  📷  VISION ANALYSIS")
    print(f"{SEP}")
    print(f"  {emoji} Scam Risk  : {risk}")
    print(f"  📋 Verdict    : {scam_result.get('verdict', 'N/A')}")
    if scam_result.get("red_flags"):
        print(f"  🚩 Red Flags : {', '.join(scam_result['red_flags'])}")
    if jargon:
        print(f"  📖 Jargon    : {', '.join(jargon.keys())}")
    print(f"{SEP}")
    print(f"  🤖  EXPLANATION")
    print(f"{SEP}")
    for line in explanation.splitlines():
        print(f"  {line}")
    print(f"{SEP2}\n")