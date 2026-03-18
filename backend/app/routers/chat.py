from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
from app.services.rag import query as rag_query
from app.services.llm import generate_answer, is_off_topic
from app.services.translate import is_supported, SUPPORTED_LANGUAGES

router = APIRouter()


class HistoryTurn(BaseModel):
    role:    str  # "user" or "assistant"
    content: str


class ChatRequest(BaseModel):
    message:        str                   = Field(..., min_length=1, max_length=2000)
    language:       str                   = Field("en")
    simplify:       bool                  = Field(True)
    history:        list[HistoryTurn]     = Field(default_factory=list)  # ✅ conversation history
    vision_context: Optional[str]         = Field(None)


class ChatResponse(BaseModel):
    reply:       str
    language:    str
    simplified:  bool
    sources:     list[str]
    source_type: str


@router.post("/", response_model=ChatResponse)
async def chat(req: ChatRequest):
    # 1. Validate language
    lang = req.language.lower()
    if not is_supported(lang):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported language '{lang}'. Supported: {list(SUPPORTED_LANGUAGES.keys())}",
        )

    # 2. Convert history to plain dicts for llm.py
    history = [{"role": t.role, "content": t.content} for t in req.history]

    # 3. Vision context — skip guard, use image explanation as context
    if req.vision_context:
        print(f"[Chat] 📄 Vision context present — skipping off-topic guard.")
        answer = generate_answer(
            question=req.message,
            context_chunks=[req.vision_context],
            language=lang,
            simplify=req.simplify,
            history=history,
        )
        return ChatResponse(
            reply=answer,
            language=lang,
            simplified=req.simplify,
            sources=["uploaded image"],
            source_type="vision",
        )

    # 4. Off-topic guard (skip for short follow-ups that reference history)
    # Heuristic: if history exists and message is short (<= 60 chars), it's
    # likely a follow-up — skip the guard to avoid blocking valid continuations.
    is_followup = len(history) > 0 and len(req.message.strip()) <= 60
    if not is_followup:
        blocked, refusal_message = is_off_topic(req.message, lang)
        if blocked:
            print(f"[Guard] 🚫 Blocked: '{req.message}'")
            return ChatResponse(
                reply=refusal_message,
                language=lang,
                simplified=req.simplify,
                sources=[],
                source_type="blocked",
            )

    # 5. Retrieve RAG chunks
    context_chunks = rag_query(req.message)

    # 6. Source type detection
    source_type = "none"
    sources     = []
    if context_chunks:
        if any("http" in c or "www" in c for c in context_chunks):
            source_type = "web"
            sources     = ["web search"]
        else:
            source_type = "document"
            sources     = ["uploaded document"]

    print(f"\n[Chat] {len(context_chunks)} chunks | source={source_type} | lang={lang} | history={len(history)}")

    # 7. Generate answer with history
    answer = generate_answer(
        question=req.message,
        context_chunks=context_chunks,
        language=lang,
        simplify=req.simplify,
        history=history,
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