from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
from app.services.rag import query as rag_query
from app.services.llm import generate_answer, is_off_topic, _sanitize_input
from app.services.translate import is_supported, SUPPORTED_LANGUAGES

# ── Try to import category features from second code (optional) ──────────────
# If detect_category / list_categories don't exist yet, gracefully degrade.
try:
    from app.services.llm import detect_category
    HAS_CATEGORY = True
except ImportError:
    HAS_CATEGORY = False
    def detect_category(msg): return None

try:
    from app.services.rag import list_categories
    HAS_LIST_CATEGORIES = True
except ImportError:
    HAS_LIST_CATEGORIES = False

router = APIRouter()


# ── Request / Response models ─────────────────────────────────────────────────
class HistoryTurn(BaseModel):
    role:    str
    content: str


class ChatRequest(BaseModel):
    message:        str                = Field(..., min_length=1, max_length=2000)
    language:       str                = Field("en")
    simplify:       bool               = Field(True)
    history:        list[HistoryTurn]  = Field(default_factory=list)
    vision_context: Optional[str]      = Field(None)


class ChatResponse(BaseModel):
    reply:             str
    language:          str
    simplified:        bool
    sources:           list[str]
    source_type:       str
    jargon:            dict[str, str]
    scam_alert:        Optional[dict]
    detected_category: Optional[str]   # ✅ from second code


# ── Main route ────────────────────────────────────────────────────────────────
@router.post("/", response_model=ChatResponse)
async def chat(req: ChatRequest):

    # 1. Validate language
    lang = req.language.lower()
    if not is_supported(lang):
        lang = "en"

    history = [{"role": t.role, "content": t.content} for t in req.history]

    # 2. Vision path — skip guard, inject vision as first context chunk
    if req.vision_context:
        result = generate_answer(
            question=req.message,
            context_chunks=[req.vision_context],
            language=lang,
            simplify=req.simplify,
            history=history,
        )
        return ChatResponse(
            reply=result["reply"],
            language=lang,
            simplified=req.simplify,
            sources=["uploaded image"],
            source_type="vision",
            jargon=result["jargon"],
            scam_alert=result.get("scam_alert"),
            detected_category=None,
        )

    # 3. URL check — skip guard for messages containing links (scam reports)
    sanitized_msg, found_urls = _sanitize_input(req.message)
    has_url     = len(found_urls) > 0
    is_followup = len(history) > 0 and len(req.message.strip()) <= 60

    # 4. Off-topic guard (only if no URL and not a short follow-up)
    if not has_url and not is_followup:
        blocked, refusal_message = is_off_topic(req.message, lang)
        if blocked:
            print(f"[Guard] 🚫 Blocked: '{req.message[:60]}'")
            return ChatResponse(
                reply=refusal_message,
                language=lang,
                simplified=req.simplify,
                sources=[],
                source_type="blocked",
                jargon={},
                scam_alert=None,
                detected_category=None,
            )

    # 5. ✅ Category detection (from second code)
    category = detect_category(req.message) if HAS_CATEGORY else None
    if category:
        print(f"[Chat] 🗂️  Detected category: '{category}'")

    # 6. ✅ RAG retrieval with optional category filter (from second code)
    context_chunks = rag_query(req.message, category=category) if category else rag_query(req.message)

    # If category-filtered retrieval returned nothing, retry without filter
    if not context_chunks and category:
        print(f"[Chat] No chunks with category '{category}', retrying without filter...")
        context_chunks = rag_query(req.message)

    # 7. Determine source type
    source_type = "none"
    sources     = []
    if context_chunks:
        if any("http" in c or "www" in c for c in context_chunks):
            source_type = "web"
            sources     = ["web search"]
        else:
            source_type = "document"
            sources     = ["uploaded document"]

    print(f"\n[Chat] {len(context_chunks)} chunks | source={source_type} | "
          f"category={category} | history={len(history)} | urls={len(found_urls)}")

    # 8. Generate answer
    result = generate_answer(
        question=req.message,
        context_chunks=context_chunks,
        language=lang,
        simplify=req.simplify,
        history=history,
    )

    return ChatResponse(
        reply=result["reply"],
        language=lang,
        simplified=req.simplify,
        sources=sources,
        source_type=source_type,
        jargon=result["jargon"],
        scam_alert=result.get("scam_alert"),
        detected_category=category,
    )


# ── Utility routes ────────────────────────────────────────────────────────────
@router.get("/languages")
def get_supported_languages():
    return {
        "languages": [
            {"code": code, "name": name}
            for code, name in SUPPORTED_LANGUAGES.items()
        ]
    }


@router.get("/categories")
def get_available_categories():
    """Returns available RAG categories if supported."""
    if HAS_LIST_CATEGORIES:
        return {"categories": list_categories()}
    return {"categories": [], "note": "Category filtering not enabled"}