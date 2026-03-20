"""
eligibility.py
--------------
Eligibility checker for Malaysian government aid programmes.
Currently supports: STR (Sumbangan Tunai Rahmah)

Flow:
  POST /eligibility/check  — conversational eligibility check, step by step
"""

from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import Optional

router = APIRouter()

# ── STR Eligibility Rules (2024/2025) ─────────────────────────────────────────
STR_RULES = {
    "max_income_single":    2500,
    "max_income_household": 5000,
    "min_age":              18,
}

# ── Step 0: Ask which programme ───────────────────────────────────────────────
PROGRAMME_QUESTION = {
    "en": "Which government assistance programme would you like to apply for?",
    "ms": "Program bantuan kerajaan manakah yang ingin anda mohon?",
    "zh": "您想申请哪个政府援助计划?",
    "ta": "எந்த அரசு உதவி திட்டத்திற்கு விண்ணப்பிக்க விரும்புகிறீர்கள்?",
}

# ── STR eligibility questions ─────────────────────────────────────────────────
STR_QUESTIONS = [
    {
        "key":  "citizenship",
        "type": "boolean",
        "question": {
            "en": "Are you a Malaysian citizen? (Yes / No)",
            "ms": "Adakah anda warganegara Malaysia? (Ya / Tidak)",
            "zh": "您是马来西亚公民吗？（是 / 否）",
            "ta": "நீங்கள் மலேசிய குடிமகனா? (ஆம் / இல்லை)",
        },
    },
    {
        "key":  "age",
        "type": "number",
        "question": {
            "en": "How old are you?",
            "ms": "Berapakah umur anda?",
            "zh": "您多大了？",
            "ta": "உங்கள் வயது என்ன?",
        },
    },
    {
        "key":  "marital_status",
        "type": "marital",
        "question": {
            "en": "What is your marital status?\n(Single / Married / Divorced / Widowed)",
            "ms": "Apakah status perkahwinan anda?\n(Bujang / Berkahwin / Bercerai / Balu/Duda)",
            "zh": "您的婚姻状况？\n（单身 / 已婚 / 离婚 / 丧偶）",
            "ta": "உங்கள் திருமண நிலை?\n(திருமணமாகாத / திருமணமான / விவாகரத்து / விதவை)",
        },
    },
    {
        "key":  "monthly_income",
        "type": "number",
        "question": {
            "en": "What is your total monthly household income in RM?\n(numbers only, e.g. 2000)",
            "ms": "Berapakah jumlah pendapatan bulanan isi rumah anda dalam RM?\n(nombor sahaja, cth: 2000)",
            "zh": "您家庭每月总收入是多少令吉？\n（仅数字，例如：2000）",
            "ta": "உங்கள் குடும்ப மாத வருமானம் எவ்வளவு RM?\n(எண்கள் மட்டும், எ.கா: 2000)",
        },
    },
    {
        "key":  "dependants",
        "type": "number",
        "question": {
            "en": "How many dependants do you have?\n(children or elderly parents living with you — enter 0 if none)",
            "ms": "Berapa ramai tanggungan anda?\n(anak-anak atau ibu bapa warga emas — masukkan 0 jika tiada)",
            "zh": "您有多少名受抚养人？\n（与您同住的子女或年长父母 — 若无请输入 0）",
            "ta": "உங்களுக்கு எத்தனை சார்ந்தோர் உள்ளனர்?\n(பிள்ளைகள் அல்லது பெற்றோர் — இல்லையெனில் 0)",
        },
    },
]


def _lang(language: str) -> str:
    return language if language in ("en", "ms", "zh", "ta") else "en"


def _get_question(index: int, language: str) -> str:
    if index >= len(STR_QUESTIONS):
        return ""
    q = STR_QUESTIONS[index]
    return q["question"][_lang(language)]


def _parse_boolean(answer: str) -> bool | None:
    a = answer.lower().strip()
    if a in ("yes", "ya", "是", "ஆம்", "y", "1", "true"):  return True
    if a in ("no", "tidak", "否", "இல்லை", "n", "0", "false"): return False
    return None


def _parse_marital(answer: str) -> str:
    a = answer.lower()
    if any(w in a for w in ["single", "bujang", "单身", "திருமணமாகாத"]): return "single"
    if any(w in a for w in ["married", "berkahwin", "已婚", "திருமணமான"]):  return "married"
    if any(w in a for w in ["divorced", "bercerai", "离婚", "விவாகரத்து"]): return "divorced"
    if any(w in a for w in ["widow", "balu", "duda", "丧偶", "விதவை", "விதுரர்"]): return "widowed"
    return "unknown"


def _check_eligibility(answers: dict, language: str) -> dict:
    citizenship    = answers.get("citizenship", False)
    age            = answers.get("age", 0)
    marital        = answers.get("marital_status", "single")
    monthly_income = answers.get("monthly_income", 0)
    dependants     = answers.get("dependants", 0)
    lang           = _lang(language)

    is_household = marital in ("married", "divorced", "widowed") or dependants > 0
    income_limit = STR_RULES["max_income_household"] if is_household else STR_RULES["max_income_single"]

    failures = []
    if not citizenship:
        failures.append({
            "en": "❌ Must be a Malaysian citizen.",
            "ms": "❌ Mesti warganegara Malaysia.",
            "zh": "❌ 必须是马来西亚公民。",
            "ta": "❌ மலேசிய குடிமகனாக இருக்க வேண்டும்.",
        })
    if age < STR_RULES["min_age"]:
        failures.append({
            "en": f"❌ Must be at least {STR_RULES['min_age']} years old.",
            "ms": f"❌ Mestilah berumur sekurang-kurangnya {STR_RULES['min_age']} tahun.",
            "zh": f"❌ 必须年满{STR_RULES['min_age']}岁。",
            "ta": f"❌ குறைந்தது {STR_RULES['min_age']} வயதாக இருக்க வேண்டும்.",
        })
    if monthly_income > income_limit:
        failures.append({
            "en": f"❌ Monthly income RM{monthly_income:,} exceeds the limit of RM{income_limit:,}.",
            "ms": f"❌ Pendapatan bulanan RM{monthly_income:,} melebihi had RM{income_limit:,}.",
            "zh": f"❌ 月收入RM{monthly_income:,}超过上限RM{income_limit:,}。",
            "ta": f"❌ மாத வருமானம் RM{monthly_income:,} வரம்பான RM{income_limit:,}ஐ மீறுகிறது.",
        })

    eligible = len(failures) == 0

    if eligible:
        labels = {
            "en": "✅ You likely qualify for STR!",
            "ms": "✅ Anda mungkin layak untuk STR!",
            "zh": "✅ 您可能符合STR资格！",
            "ta": "✅ நீங்கள் STR க்கு தகுதியுடையவராக இருக்கலாம்!",
        }
        details = {
            "en": (f"Based on your answers:\n"
                   f"• Citizenship: ✅\n"
                   f"• Age: {age} ✅\n"
                   f"• Monthly income: RM{monthly_income:,} (limit: RM{income_limit:,}) ✅\n"
                   f"• Dependants: {dependants}\n\n"
                   f"You meet the basic STR criteria. Ready to fill the application form?"),
            "ms": (f"Berdasarkan jawapan anda:\n"
                   f"• Kewarganegaraan: ✅\n"
                   f"• Umur: {age} ✅\n"
                   f"• Pendapatan bulanan: RM{monthly_income:,} (had: RM{income_limit:,}) ✅\n"
                   f"• Tanggungan: {dependants}\n\n"
                   f"Anda memenuhi kriteria asas STR. Sedia untuk mengisi borang permohonan?"),
            "zh": (f"根据您的回答：\n"
                   f"• 公民身份：✅\n"
                   f"• 年龄：{age} ✅\n"
                   f"• 月收入：RM{monthly_income:,}（上限：RM{income_limit:,}）✅\n"
                   f"• 受抚养人：{dependants}\n\n"
                   f"您符合STR基本标准。准备填写申请表了吗？"),
            "ta": (f"உங்கள் பதில்களின் அடிப்படையில்:\n"
                   f"• குடியுரிமை: ✅\n"
                   f"• வயது: {age} ✅\n"
                   f"• மாத வருமானம்: RM{monthly_income:,} (வரம்பு: RM{income_limit:,}) ✅\n"
                   f"• சார்ந்தோர்: {dependants}\n\n"
                   f"நீங்கள் அடிப்படை STR தகுதியை பூர்த்தி செய்கிறீர்கள். விண்ணப்பப் படிவம் நிரப்ப தயாரா?"),
        }
    else:
        labels = {
            "en": "❌ You may not qualify for STR at this time.",
            "ms": "❌ Anda mungkin tidak layak untuk STR pada masa ini.",
            "zh": "❌ 您目前可能不符合STR资格。",
            "ta": "❌ தற்போது நீங்கள் STR க்கு தகுதியற்றவராக இருக்கலாம்.",
        }
        reason_lines = [f[lang] for f in failures]
        outro = {
            "en": "\nYou can explore other government aid programmes that may suit you.",
            "ms": "\nAnda boleh meneroka program bantuan kerajaan lain yang mungkin sesuai.",
            "zh": "\n您可以了解其他可能适合您的政府援助计划。",
            "ta": "\nஉங்களுக்கு ஏற்ற மற்ற அரசு உதவி திட்டங்களை ஆராயலாம்.",
        }
        details = {l: "\n".join(reason_lines) + outro[l] for l in ("en","ms","zh","ta")}

    return {
        "eligible":     eligible,
        "result_label": labels[lang],
        "details":      details[lang],
    }


# ── Models ────────────────────────────────────────────────────────────────────
class EligibilityRequest(BaseModel):
    user_answer:  Optional[str] = Field(None)
    current_step: int           = Field(0)
    collected:    dict          = Field(default_factory=dict)
    language:     str           = Field("en")


class EligibilityResponse(BaseModel):
    question:     Optional[str]
    current_step: int
    collected:    dict
    is_complete:  bool
    result:       Optional[dict] = None
    error:        Optional[str]  = None


# ── Route ─────────────────────────────────────────────────────────────────────
@router.post("/check", response_model=EligibilityResponse)
async def check_eligibility(req: EligibilityRequest):
    collected    = dict(req.collected)
    current_step = req.current_step   # step 0 = programme select, steps 1-5 = STR questions
    language     = req.language
    lang         = _lang(language)

    # ── Step 0: Programme selection ───────────────────────────────────────
    if req.user_answer is not None and current_step == 0:
        ans = req.user_answer.strip().lower()
        if "str" in ans or "sumbangan" in ans or "tunai" in ans or "rahmah" in ans:
            # Confirmed STR — move to question 1
            current_step = 1
        else:
            # Not recognised — ask again
            not_supported = {
                "en": "Sorry, I only support STR for now. Please type STR to continue.",
                "ms": "Maaf, saya hanya menyokong STR buat masa ini. Sila taip STR untuk meneruskan.",
                "zh": "抱歉，目前只支持STR。请输入STR继续。",
                "ta": "மன்னிக்கவும், இப்போது STR மட்டுமே ஆதரிக்கப்படுகிறது. தொடர STR என்று தட்டச்சு செய்யவும்.",
            }
            return EligibilityResponse(
                question=not_supported[lang], current_step=0,
                collected=collected, is_complete=False,
            )

    # ── Steps 1-5: STR eligibility questions ─────────────────────────────
    elif req.user_answer is not None and 1 <= current_step <= len(STR_QUESTIONS):
        q_index = current_step - 1   # maps step 1 → question index 0
        q       = STR_QUESTIONS[q_index]
        key     = q["key"]
        qtype   = q["type"]
        ans     = req.user_answer.strip()

        error_msgs = {
            "boolean": {"en":"Please answer Yes or No.","ms":"Sila jawab Ya atau Tidak.","zh":"请回答是或否。","ta":"ஆம் அல்லது இல்லை என்று பதில் அளிக்கவும்."},
            "number":  {"en":"Please enter a number (e.g. 2500).","ms":"Sila masukkan nombor (cth: 2500).","zh":"请输入数字（例如：2500）。","ta":"எண் உள்ளிடவும் (எ.கா: 2500)."},
            "marital": {"en":"Please reply: Single / Married / Divorced / Widowed","ms":"Sila jawab: Bujang / Berkahwin / Bercerai / Balu/Duda","zh":"请回答：单身 / 已婚 / 离婚 / 丧偶","ta":"பதில் அளிக்கவும்: திருமணமாகாத / திருமணமான / விவாகரத்து / விதவை"},
        }

        if qtype == "boolean":
            val = _parse_boolean(ans)
            if val is None:
                return EligibilityResponse(
                    question=f"❌ {error_msgs['boolean'][lang]}\n\n{_get_question(q_index, language)}",
                    current_step=current_step, collected=collected, is_complete=False,
                    error=error_msgs["boolean"][lang],
                )
            collected[key] = val

        elif qtype == "number":
            clean = ans.replace(",", "").replace("RM", "").replace("rm", "").strip()
            try:
                collected[key] = int(float(clean))
            except ValueError:
                return EligibilityResponse(
                    question=f"❌ {error_msgs['number'][lang]}\n\n{_get_question(q_index, language)}",
                    current_step=current_step, collected=collected, is_complete=False,
                    error=error_msgs["number"][lang],
                )

        elif qtype == "marital":
            val = _parse_marital(ans)
            if val == "unknown":
                return EligibilityResponse(
                    question=f"❌ {error_msgs['marital'][lang]}\n\n{_get_question(q_index, language)}",
                    current_step=current_step, collected=collected, is_complete=False,
                    error=error_msgs["marital"][lang],
                )
            collected[key] = val

        current_step += 1

    # ── All questions answered → run eligibility check ────────────────────
    if current_step > len(STR_QUESTIONS):
        result = _check_eligibility(collected, language)
        return EligibilityResponse(
            question=None, current_step=current_step,
            collected=collected, is_complete=True, result=result,
        )

    # ── Return next question ──────────────────────────────────────────────
    if current_step == 0:
        return EligibilityResponse(
            question=PROGRAMME_QUESTION[lang], current_step=0,
            collected=collected, is_complete=False,
        )
    else:
        q_index = current_step - 1
        return EligibilityResponse(
            question=_get_question(q_index, language),
            current_step=current_step, collected=collected, is_complete=False,
        )