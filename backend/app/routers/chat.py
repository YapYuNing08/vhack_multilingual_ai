from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from app.services.rag import query as rag_query
from app.services.llm import generate_answer
from app.services.translate import is_supported, SUPPORTED_LANGUAGES

router = APIRouter()


# ── Off-topic guard ───────────────────────────────────────────────────────────
OFF_TOPIC_KEYWORDS = [
    # celebrities / entertainment
    "richest", "billionaire", "celebrity", "actor", "actress", "singer",
    "movie", "film", "drama", "kpop", "bts", "taylor swift", "recipe",
    "cook", "food", "restaurant", "sport", "football", "soccer", "nba",
    "gaming", "game", "anime", "manga", "horoscope", "zodiac",
    # generic trivia
    "who invented", "capital of", "tallest building", "fastest car",
]

CIVIC_KEYWORDS = [
    "ptptn", "kwsp", "epf", "socso", "lhdn", "tax", "cukai", "bantuan",
    "subsidi", "subsidy", "government", "kerajaan", "law", "undang",
    "hospital", "clinic", "klinik", "sekolah", "school", "university",
    "universiti", "scholarship", "biasiswa", "pension", "pencen",
    "permit", "lesen", "license", "ic", "passport", "visa", "mykad",
    "jpj", "jkm", "welfare", "jabatan", "ministry", "kementerian",
    "policy", "polisi", "regulation", "akta", "act", "rights", "hak",
    "worker", "pekerja", "salary", "gaji", "minimum wage", "upah",
    "healthcare", "kesihatan", "MySejahtera", "vaccination", "vaksin",
    "housing", "rumah", "pr1ma", "pprt", "brim", "sumbangan",
]


def _is_off_topic(message: str) -> bool:
    """
    Returns True if the message is clearly off-topic (not civic/government related).
    Strategy: if it contains an off-topic keyword AND zero civic keywords → reject.
    """
    lower = message.lower()
    has_off_topic = any(kw in lower for kw in OFF_TOPIC_KEYWORDS)
    has_civic     = any(kw in lower for kw in CIVIC_KEYWORDS)

    # Only block if clearly off-topic AND no civic signal at all
    return has_off_topic and not has_civic


OFF_TOPIC_REPLIES = {
    "en": (
        "I'm sorry, I can only assist with Malaysian government services, "
        "public policies, and civic matters. Please ask me something related "
        "to topics like taxes, healthcare, education, welfare, employment law, "
        "or other official services. 🙏"
    ),
    "ms": (
        "Maaf, saya hanya boleh membantu dengan perkhidmatan kerajaan Malaysia, "
        "dasar awam, dan hal-hal sivik. Sila tanya soalan berkaitan cukai, "
        "penjagaan kesihatan, pendidikan, kebajikan, undang-undang pekerjaan, "
        "atau perkhidmatan rasmi yang lain. 🙏"
    ),
    "zh": (
        "抱歉，我只能协助处理马来西亚政府服务、公共政策和公民事务。"
        "请询问与税务、医疗、教育、福利、劳工法律或其他官方服务相关的问题。🙏"
    ),
    "ta": (
        "மன்னிக்கவும், நான் மலேசிய அரசாங்க சேவைகள், பொது கொள்கைகள் மற்றும் "
        "குடிமை விஷயங்களுக்கு மட்டுமே உதவ முடியும். வரி, சுகாதாரம், கல்வி, "
        "நலன்புரி அல்லது வேலைவாய்ப்பு சட்டம் பற்றி கேளுங்கள். 🙏"
    ),
    "id": (
        "Maaf, saya hanya dapat membantu dengan layanan pemerintah Malaysia, "
        "kebijakan publik, dan urusan kewarganegaraan. Silakan tanyakan sesuatu "
        "terkait pajak, kesehatan, pendidikan, kesejahteraan, atau layanan resmi lainnya. 🙏"
    ),
}


# ── Router ────────────────────────────────────────────────────────────────────
class ChatRequest(BaseModel):
    message:  str  = Field(..., min_length=1, max_length=2000)
    language: str  = Field("en", description="Target language code")
    simplify: bool = Field(True, description="Use plain, simplified language")


class ChatResponse(BaseModel):
    reply:       str
    language:    str
    simplified:  bool
    sources:     list[str]
    source_type: str  # "document" | "web" | "none" | "blocked"


@router.post("/", response_model=ChatResponse)
async def chat(req: ChatRequest):
    # 1. Validate language
    lang = req.language.lower()
    if not is_supported(lang):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported language '{lang}'. Supported: {list(SUPPORTED_LANGUAGES.keys())}",
        )

    # 2. ✅ Off-topic guard — block BEFORE hitting RAG or LLM
    if _is_off_topic(req.message):
        print(f"[Guard] 🚫 Off-topic question blocked: '{req.message}'")
        blocked_reply = OFF_TOPIC_REPLIES.get(lang, OFF_TOPIC_REPLIES["en"])
        return ChatResponse(
            reply=blocked_reply,
            language=lang,
            simplified=req.simplify,
            sources=[],
            source_type="blocked",
        )

    # 3. Retrieve chunks from hybrid RAG (semantic + BM25)
    context_chunks = rag_query(req.message)

    # 4. Determine source type
    source_type = "none"
    sources     = []
    if context_chunks:
        if any("http" in c or "Forbes" in c or "wikipedia" in c.lower() for c in context_chunks):
            source_type = "web"
            sources     = ["web search"]
        else:
            source_type = "document"
            sources     = ["uploaded document"]

    # Debug log
    print("\n" + "=" * 40)
    print(f"DEBUG: {len(context_chunks)} chunks | source_type={source_type}")
    for i, chunk in enumerate(context_chunks):
        print(f"\n--- CHUNK {i+1} ---\n{chunk[:200]}...")
    print("=" * 40 + "\n")

    # 5. Generate grounded answer
    answer = generate_answer(
        question=req.message,
        context_chunks=context_chunks,
        language=lang,
        simplify=req.simplify,
    )

    return ChatResponse(
        reply=answer,
        language=lang,
        simplified=req.simplify,
        sources=sources,
        source_type=source_type,
    )


@router.get("/languages")
def get_supported_languages():
    return {
        "languages": [
            {"code": code, "name": name}
            for code, name in SUPPORTED_LANGUAGES.items()
        ]
    }