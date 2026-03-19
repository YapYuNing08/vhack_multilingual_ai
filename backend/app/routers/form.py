"""
form_router.py
--------------
Handles the conversational form-filler flow for Borang STR.

Flow:
  POST /form/chat     — AI asks questions, user answers, returns next question or "done"
  POST /form/generate — Takes completed form data, returns filled PDF as download
"""

import os
import json
from fastapi import APIRouter
from fastapi.responses import Response
from pydantic import BaseModel, Field
from typing import Optional
from groq import Groq

router   = APIRouter()
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL   = os.getenv("GROQ_MODEL", "llama3-8b-8192")


# ── Form field definitions ────────────────────────────────────────────────────
FORM_FIELDS = [
    {
        "key":      "nama_penuh",
        "label":    "Nama Penuh",
        "question": {
            "en": "What is your full name? (as shown on your MyKad)",
            "ms": "Apakah nama penuh anda? (seperti dalam MyKad)",
            "zh": "请问您的全名是什么？（如身份证所示）",
            "ta": "உங்கள் முழு பெயர் என்ன? (MyKad இல் உள்ளது போல்)",
        },
        "validate": "name",
    },
    {
        "key":      "no_mykad",
        "label":    "Nombor Kad Pengenalan (MyKad)",
        "question": {
            "en": "What is your MyKad (IC) number? (format: 000000-00-0000)",
            "ms": "Apakah nombor MyKad anda? (format: 000000-00-0000)",
            "zh": "请问您的MyKad号码是什么？（格式：000000-00-0000）",
            "ta": "உங்கள் MyKad எண் என்ன? (வடிவம்: 000000-00-0000)",
        },
        "validate": "ic",
    },
    {
        "key":      "no_telefon",
        "label":    "Nombor Telefon",
        "question": {
            "en": "What is your phone number? (e.g. 0123456789)",
            "ms": "Apakah nombor telefon anda? (cth: 0123456789)",
            "zh": "请问您的电话号码是什么？（例如：0123456789）",
            "ta": "உங்கள் தொலைபேசி எண் என்ன? (எ.கா: 0123456789)",
        },
        "validate": "phone",
    },
    {
        "key":      "emel",
        "label":    "E-mel",
        "question": {
            "en": "What is your email address?",
            "ms": "Apakah alamat e-mel anda?",
            "zh": "请问您的电子邮件地址是什么？",
            "ta": "உங்கள் மின்னஞ்சல் முகவரி என்ன?",
        },
        "validate": "email",
    },
    {
        "key":      "pendapatan_bulanan",
        "label":    "Pendapatan Bulanan (RM)",
        "question": {
            "en": "What is your monthly household income in RM? (numbers only, e.g. 2500)",
            "ms": "Berapakah pendapatan bulanan isi rumah anda dalam RM? (nombor sahaja, cth: 2500)",
            "zh": "您家庭的月收入是多少令吉？（仅数字，例如：2500）",
            "ta": "உங்கள் மாத வருமானம் எவ்வளவு RM? (எண்கள் மட்டும், எ.கா: 2500)",
        },
        "validate": "number",
    },
    {
        "key":      "status_perkahwinan",
        "label":    "Status Perkahwinan",
        "question": {
            "en": "What is your marital status? Reply with: Single / Married / Divorced / Widowed",
            "ms": "Apakah status perkahwinan anda? Jawab dengan: Bujang / Berkahwin / Bercerai / Balu/Duda",
            "zh": "您的婚姻状况是什么？请回答：单身 / 已婚 / 离婚 / 丧偶",
            "ta": "உங்கள் திருமண நிலை என்ன? பதில் அளிக்கவும்: திருமணமாகாத / திருமணமான / விவாகரத்து / விதவை/விதுரர்",
        },
        "validate": "marital",
    },
]


class FormChatRequest(BaseModel):
    user_answer:   Optional[str] = Field(None)
    current_field: int           = Field(0, description="Index of field currently being filled")
    collected:     dict          = Field(default_factory=dict)
    language:      str           = Field("en")


class FormChatResponse(BaseModel):
    question:      Optional[str]
    current_field: int
    collected:     dict
    is_complete:   bool
    error:         Optional[str] = None


class GenerateFormRequest(BaseModel):
    collected: dict
    language:  str = "en"


# ── Helpers ───────────────────────────────────────────────────────────────────
def _get_question(field_index: int, language: str) -> str:
    """Get the question for a field in the user's language."""
    if field_index >= len(FORM_FIELDS):
        return ""
    field = FORM_FIELDS[field_index]
    lang  = language if language in field["question"] else "en"
    return field["question"][lang]


def _validate_and_clean(field_index: int, answer: str, language: str) -> tuple[bool, str, str]:
    """
    Validate user's answer for the current field.
    Returns (is_valid, cleaned_value, error_message).
    """
    field    = FORM_FIELDS[field_index]
    validate = field.get("validate", "text")
    answer   = answer.strip()

    if not answer:
        errors = {
            "en": "Please provide an answer.",
            "ms": "Sila berikan jawapan.",
            "zh": "请提供答案。",
            "ta": "தயவுசெய்து பதில் அளிக்கவும்.",
        }
        return False, "", errors.get(language, errors["en"])

    if validate == "ic":
        # Remove dashes/spaces
        cleaned = answer.replace("-", "").replace(" ", "")
        if not cleaned.isdigit() or len(cleaned) != 12:
            errors = {
                "en": "Invalid IC number. Please enter 12 digits (e.g. 900101011234).",
                "ms": "Nombor IC tidak sah. Sila masukkan 12 digit (cth: 900101011234).",
                "zh": "IC号码无效。请输入12位数字（例如：900101011234）。",
                "ta": "தவறான IC எண். 12 இலக்கங்களை உள்ளிடவும் (எ.கா: 900101011234).",
            }
            return False, "", errors.get(language, errors["en"])
        # Format with dashes
        return True, f"{cleaned[:6]}-{cleaned[6:8]}-{cleaned[8:]}", ""

    if validate == "phone":
        cleaned = answer.replace("-", "").replace(" ", "")
        if not cleaned.isdigit() or len(cleaned) < 9 or len(cleaned) > 12:
            errors = {
                "en": "Invalid phone number. Please enter digits only (e.g. 0123456789).",
                "ms": "Nombor telefon tidak sah. Sila masukkan digit sahaja (cth: 0123456789).",
                "zh": "电话号码无效。请仅输入数字（例如：0123456789）。",
                "ta": "தொலைபேசி எண் தவறானது. இலக்கங்களை மட்டும் உள்ளிடவும்.",
            }
            return False, "", errors.get(language, errors["en"])
        return True, cleaned, ""

    if validate == "email":
        if "@" not in answer or "." not in answer.split("@")[-1]:
            errors = {
                "en": "Invalid email address. Please try again.",
                "ms": "Alamat e-mel tidak sah. Sila cuba lagi.",
                "zh": "电子邮件地址无效。请重试。",
                "ta": "மின்னஞ்சல் முகவரி தவறானது. மீண்டும் முயற்சிக்கவும்.",
            }
            return False, "", errors.get(language, errors["en"])
        return True, answer.lower(), ""

    if validate == "number":
        cleaned = answer.replace(",", "").replace("RM", "").replace("rm", "").strip()
        try:
            val = float(cleaned)
            if val < 0:
                raise ValueError()
            return True, str(int(val)), ""
        except Exception:
            errors = {
                "en": "Please enter a valid amount in RM (numbers only, e.g. 2500).",
                "ms": "Sila masukkan jumlah yang sah dalam RM (nombor sahaja, cth: 2500).",
                "zh": "请输入有效金额（仅数字，例如：2500）。",
                "ta": "சரியான தொகையை உள்ளிடவும் (எண்கள் மட்டும்).",
            }
            return False, "", errors.get(language, errors["en"])

    if validate == "marital":
        answer_lower = answer.lower()
        mapping = {
            "single": "Bujang", "bujang": "Bujang", "lajang": "Bujang", "单身": "Bujang",
            "married": "Berkahwin", "berkahwin": "Berkahwin", "kahwin": "Berkahwin", "已婚": "Berkahwin",
            "divorced": "Bercerai", "bercerai": "Bercerai", "cerai": "Bercerai", "离婚": "Bercerai",
            "widowed": "Balu/Duda", "widow": "Balu/Duda", "widower": "Balu/Duda",
            "balu": "Balu/Duda", "duda": "Balu/Duda", "丧偶": "Balu/Duda",
            "விவாகரத்து": "Bercerai", "திருமணமான": "Berkahwin",
            "திருமணமாகாத": "Bujang", "விதவை": "Balu/Duda", "விதுரர்": "Balu/Duda",
        }
        for key, value in mapping.items():
            if key in answer_lower:
                return True, value, ""
        errors = {
            "en": "Please reply with: Single / Married / Divorced / Widowed",
            "ms": "Sila jawab: Bujang / Berkahwin / Bercerai / Balu/Duda",
            "zh": "请回答：单身 / 已婚 / 离婚 / 丧偶",
            "ta": "பதில் அளிக்கவும்: திருமணமாகாத / திருமணமான / விவாகரத்து / விதவை/விதுரர்",
        }
        return False, "", errors.get(language, errors["en"])

    # Default text — just accept as-is
    return True, answer, ""


def _confirmation_message(collected: dict, language: str) -> str:
    """Generate a summary confirmation message in the user's language."""
    labels = {
        "en": {
            "nama_penuh": "Full Name", "no_mykad": "IC Number",
            "no_telefon": "Phone", "emel": "Email",
            "pendapatan_bulanan": "Monthly Income (RM)", "status_perkahwinan": "Marital Status",
            "intro": "Here is your STR application summary:",
            "outro": "Your filled form is ready to download! Please print and submit it to the nearest welfare office.",
        },
        "ms": {
            "nama_penuh": "Nama Penuh", "no_mykad": "Nombor IC",
            "no_telefon": "Telefon", "emel": "E-mel",
            "pendapatan_bulanan": "Pendapatan Bulanan (RM)", "status_perkahwinan": "Status Perkahwinan",
            "intro": "Berikut adalah ringkasan permohonan STR anda:",
            "outro": "Borang anda sedia untuk dimuat turun! Sila cetak dan hantar ke pejabat kebajikan terdekat.",
        },
        "zh": {
            "nama_penuh": "全名", "no_mykad": "IC号码",
            "no_telefon": "电话", "emel": "电子邮件",
            "pendapatan_bulanan": "月收入 (RM)", "status_perkahwinan": "婚姻状况",
            "intro": "以下是您的STR申请摘要：",
            "outro": "您的表格已准备好下载！请打印并提交到最近的福利办公室。",
        },
        "ta": {
            "nama_penuh": "முழு பெயர்", "no_mykad": "IC எண்",
            "no_telefon": "தொலைபேசி", "emel": "மின்னஞ்சல்",
            "pendapatan_bulanan": "மாத வருமானம் (RM)", "status_perkahwinan": "திருமண நிலை",
            "intro": "உங்கள் STR விண்ணப்ப சுருக்கம்:",
            "outro": "உங்கள் படிவம் பதிவிறக்கத்திற்கு தயாராக உள்ளது! அருகிலுள்ள நலன்புரி அலுவலகத்தில் சமர்ப்பிக்கவும்.",
        },
    }

    lang_labels = labels.get(language, labels["en"])
    lines = [lang_labels["intro"], ""]
    for key, val in collected.items():
        label = lang_labels.get(key, key)
        lines.append(f"• {label}: {val}")
    lines.append("")
    lines.append(lang_labels["outro"])
    return "\n".join(lines)


# ── Routes ────────────────────────────────────────────────────────────────────
@router.post("/chat", response_model=FormChatResponse)
async def form_chat(req: FormChatRequest):
    """
    Conversational form filler.
    On each call:
    - Validate the previous answer (if any)
    - Return the next question, or mark complete
    """
    collected     = dict(req.collected)
    current_field = req.current_field
    language      = req.language

    # Validate and store the user's answer to the PREVIOUS question
    if req.user_answer is not None and current_field < len(FORM_FIELDS):
        is_valid, cleaned, error_msg = _validate_and_clean(current_field, req.user_answer, language)
        if not is_valid:
            # Return same question with error
            return FormChatResponse(
                question=f"❌ {error_msg}\n\n{_get_question(current_field, language)}",
                current_field=current_field,
                collected=collected,
                is_complete=False,
                error=error_msg,
            )
        # Store valid answer and advance
        field_key = FORM_FIELDS[current_field]["key"]
        collected[field_key] = cleaned
        current_field += 1

    # Check if all fields are done
    if current_field >= len(FORM_FIELDS):
        return FormChatResponse(
            question=_confirmation_message(collected, language),
            current_field=current_field,
            collected=collected,
            is_complete=True,
        )

    # Return next question
    return FormChatResponse(
        question=_get_question(current_field, language),
        current_field=current_field,
        collected=collected,
        is_complete=False,
    )


@router.post("/generate")
async def generate_form(req: GenerateFormRequest):
    """Generate and return the filled STR PDF."""
    try:
        from app.services.form_filler import fill_str_form
        pdf_bytes = fill_str_form(req.collected)

        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": 'attachment; filename="Borang_STR_SilaSpeak.pdf"',
                "Content-Length": str(len(pdf_bytes)),
            }
        )
    except Exception as e:
        print(f"[FormRouter] PDF generation error: {e}")
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {str(e)}")