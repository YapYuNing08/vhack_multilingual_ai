from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from app.services.rag import query as rag_query
from app.services.llm import generate_answer, is_off_topic
from app.services.translate import is_supported, SUPPORTED_LANGUAGES

router = APIRouter()


class ChatRequest(BaseModel):
    message:  str  = Field(..., min_length=1, max_length=2000)
    language: str  = Field("en", description="Target language code")
    simplify: bool = Field(True,  description="Use plain, simplified language")


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

    # 2. ✅ LLM-based off-topic guard (smarter than keyword matching)
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

    # 3. Retrieve chunks via hybrid RAG
    context_chunks = rag_query(req.message)

    # 4. Determine source type for frontend badge
    source_type = "none"
    sources     = []
    if context_chunks:
        if any("http" in c or "www" in c or "Forbes" in c for c in context_chunks):
            source_type = "web"
            sources     = ["web search"]
        else:
            source_type = "document"
            sources     = ["uploaded document"]

    # Debug
    print(f"\n[Chat] {len(context_chunks)} chunks | source={source_type} | lang={lang}")

    # 5. Generate answer
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