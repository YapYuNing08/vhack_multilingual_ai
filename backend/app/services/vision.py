import base64
import os
import json
from groq import Groq

VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"


def analyze_document_image(image_bytes: bytes, language: str) -> dict:
    """
    Analyses a document image and returns:
    - explanation:  simplified summary (scam-safe action steps if fraud detected)
    - scam_result:  { is_scam, risk_level, red_flags[], safe_indicators[], verdict }
    - jargon:       { "TERM": "plain explanation" }
    """
    base64_image = base64.b64encode(image_bytes).decode('utf-8')

    lang_map = {
        "en": "English", "ms": "Bahasa Malaysia",
        "zh": "Simplified Chinese", "ta": "Tamil", "id": "Bahasa Indonesia",
    }
    ui_language = lang_map.get(language, "English")

    client = Groq(api_key=os.environ.get("GROQ_API_KEY"))

    # ── Step 1: Scam detection first ──────────────────────────────────────
    scam_prompt = """
You are a Malaysian government document fraud expert and scam detector.
Examine this document image for signs of fraud or scams.

RED FLAGS to check:
- Requests for bank account numbers, PINs, or passwords
- Unofficial contact methods (personal WhatsApp, Gmail addresses)
- Threats of immediate arrest, fine, or account suspension
- Urgency pressure tactics ("respond within 24 hours")
- Unofficial logos, poor formatting, spelling errors
- Requests to click suspicious links or scan unknown QR codes
- Impersonation of LHDN, PDRM, Bank Negara, EPF, SOCSO
- Requests for payment via crypto, gift cards, personal transfers
- Links to non-.gov.my domains

SAFE INDICATORS:
- Official government letterhead and logo
- Reference/case numbers in standard format
- Official .gov.my email domains
- No requests for passwords or credentials

Respond ONLY with valid JSON (no markdown):
{
  "is_scam": true/false,
  "risk_level": "HIGH" | "MEDIUM" | "LOW" | "SAFE",
  "red_flags": ["flag1", "flag2"],
  "safe_indicators": ["indicator1", "indicator2"],
  "verdict": "One sentence summary of the fraud assessment"
}
"""

    print(f"\n[Vision] 🔍 Analyzing document with {VISION_MODEL}...")

    try:
        # Run scam check first
        scam_response = client.chat.completions.create(
            model=VISION_MODEL,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text",      "text": scam_prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}}
                ]
            }],
            temperature=0.0,
            max_tokens=512,
        )

        scam_raw = scam_response.choices[0].message.content.strip()
        try:
            scam_result = json.loads(scam_raw.replace("```json", "").replace("```", "").strip())
        except json.JSONDecodeError:
            scam_result = {
                "is_scam": False, "risk_level": "UNKNOWN",
                "red_flags": [], "safe_indicators": [],
                "verdict": "Could not perform fraud analysis."
            }

        is_high_risk = scam_result.get("risk_level") in ("HIGH", "MEDIUM")

        # ── Step 2: Explanation with scam-aware action steps ──────────────
        if is_high_risk:
            action_instruction = """
⚠️ SCAM SAFETY OVERRIDE — CRITICAL:
This document has been flagged as a potential scam.
For the actionable steps you MUST:
1. WARN the user clearly that this looks like a scam.
2. Tell them to NOT click any links, NOT provide bank details, NOT call any number in the document.
3. Give ONLY these safe offline verification steps:
   - Call the official agency hotline (LHDN: 03-8911 1000, PDRM: 999, BNM: 1-300-88-5465)
   - Visit the official .gov.my website by typing it manually in a browser
   - Visit the nearest physical office in person
   - Report to CyberSecurity Malaysia: 1-300-88-2999 or aduan.cyber999.com.my
4. Do NOT suggest clicking any link under any circumstance.
"""
        else:
            action_instruction = "Provide normal actionable steps based on the document content."

        explain_prompt = f"""
You are SilaSpeak, an AI helping Malaysian citizens understand government letters, bills, and notices.
Look at this document image.

1. Identify who sent it (e.g., LHDN, JPJ, Hospital, Ministry).
2. Extract any important dates, deadlines, or appointment times.
3. Explain the main purpose in very simple, 5th-grade terms.
4. Actionable steps: {action_instruction}

CRITICAL: Write your ENTIRE response in {ui_language}.
"""

        explain_response = client.chat.completions.create(
            model=VISION_MODEL,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text",      "text": explain_prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}}
                ]
            }],
            temperature=0.1,
            max_tokens=1024,
        )

        explanation = explain_response.choices[0].message.content.strip()

        # ── Step 3: Jargon extraction from explanation ────────────────────
        jargon_map = _extract_jargon_vision(explanation, ui_language)

        # ── Step 4: Full terminal debug output ────────────────────────────
        _debug_vision(explanation, scam_result, jargon_map)

        return {
            "explanation": explanation,
            "scam_result": scam_result,
            "jargon":      jargon_map,
        }

    except Exception as e:
        print(f"[Vision] ❌ Error: {e}")
        return {
            "explanation": f"Sorry, I encountered an error reading the image: {str(e)}",
            "scam_result": {
                "is_scam": False, "risk_level": "UNKNOWN",
                "red_flags": [], "safe_indicators": [],
                "verdict": "Fraud analysis unavailable."
            },
            "jargon": {},
        }


def _extract_jargon_vision(explanation: str, language: str) -> dict[str, str]:
    """Extract government jargon from the vision explanation."""
    try:
        client = Groq(api_key=os.environ.get("GROQ_API_KEY"))
        from groq import Groq as _Groq
        result = client.chat.completions.create(
            model=VISION_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"Identify government jargon in this text that an elderly person might not understand. "
                        f"Examples: LHDN, MyKad, EPF, SOCSO, cukai, subsidised, eligible.\n\n"
                        f"For each term, give a 1-sentence plain explanation in {language}.\n\n"
                        f"Reply ONLY with JSON (no markdown): "
                        f'{{ "TERM": "explanation" }}\n'
                        f"If none found, return: {{}}\n\n"
                        f"TEXT:\n{explanation}"
                    ),
                }
            ],
            temperature=0.1,
            max_tokens=512,
        )
        raw = result.choices[0].message.content.strip()
        jargon_map   = json.loads(raw.replace("```json", "").replace("```", "").strip())
        answer_lower = explanation.lower()
        return {k: v for k, v in jargon_map.items() if k.lower() in answer_lower}
    except Exception as e:
        print(f"[Vision] Jargon extraction failed: {e}")
        return {}


def _debug_vision(explanation: str, scam_result: dict, jargon: dict):
    """Print full vision analysis to terminal clearly."""
    SEP  = "─" * 60
    SEP2 = "═" * 60
    risk  = scam_result.get("risk_level", "?")
    emoji = {"HIGH": "🚨", "MEDIUM": "⚠️", "LOW": "🔍", "SAFE": "✅"}.get(risk, "❓")

    print(f"\n{SEP2}")
    print(f"  📷  VISION ANALYSIS")
    print(f"{SEP}")
    print(f"  {emoji} Scam Risk   : {risk}")
    print(f"  📋 Verdict     : {scam_result.get('verdict', 'N/A')}")
    if scam_result.get("red_flags"):
        print(f"  🚩 Red Flags  : {', '.join(scam_result['red_flags'])}")
    if scam_result.get("safe_indicators"):
        print(f"  ✅ Safe Signs : {', '.join(scam_result['safe_indicators'])}")
    if jargon:
        print(f"  📖 Jargon     : {', '.join(jargon.keys())}")
    print(f"{SEP}")
    print(f"  🤖  EXPLANATION")
    print(f"{SEP}")
    # Print full explanation — no truncation
    for line in explanation.splitlines():
        print(f"  {line}")
    print(f"{SEP2}\n")