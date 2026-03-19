from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
from app.services.rag import query as rag_query
from app.services.llm import generate_answer, is_off_topic, _sanitize_input
from app.services.translate import is_supported, SUPPORTED_LANGUAGES

router = APIRouter()


class HistoryTurn(BaseModel):
    role:    str
    content: str


class ChatRequest(BaseModel):
    message:        str               = Field(..., min_length=1, max_length=2000)
    language:       str               = Field("en")
    simplify:       bool              = Field(True)
    history:        list[HistoryTurn] = Field(default_factory=list)
    vision_context: Optional[str]     = Field(None)


class ChatResponse(BaseModel):
    reply:       str
    language:    str
    simplified:  bool
    sources:     list[str]
    source_type: str
    jargon:      dict[str, str]
    scam_alert:  Optional[dict]


@router.post("/", response_model=ChatResponse)
async def chat(req: ChatRequest):
    lang = req.language.lower()
    if not is_supported(lang):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported language '{lang}'. Supported: {list(SUPPORTED_LANGUAGES.keys())}",
        )

    history = [{"role": t.role, "content": t.content} for t in req.history]

    # Vision path — skip guard entirely
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
        )

    # ✅ BUG 1 FIX: Check for URLs BEFORE running the off-topic guard.
    # Messages with URLs are either scam reports or civic verification questions.
    # They must NEVER be blocked — always pass them through to generate_answer
    # which has the scam safety override built in.
    sanitized_msg, found_urls = _sanitize_input(req.message)
    has_url = len(found_urls) > 0

    # Follow-up heuristic: short messages with history are continuations
    is_followup = len(history) > 0 and len(req.message.strip()) <= 60

    # Only run the guard if: no URL found AND not a short follow-up
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
            )

    context_chunks = rag_query(req.message)

    source_type = "none"
    sources     = []
    if context_chunks:
        if any("http" in c or "www" in c for c in context_chunks):
            source_type = "web"
            sources     = ["web search"]
        else:
            source_type = "document"
            sources     = ["uploaded document"]

    print(f"\n[Chat] {len(context_chunks)} chunks | source={source_type} | history={len(history)} | urls={len(found_urls)}")

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
    )


@router.get("/languages")
def get_supported_languages():
    return {
        "languages": [
            {"code": code, "name": name}
            for code, name in SUPPORTED_LANGUAGES.items()
        ]
    }