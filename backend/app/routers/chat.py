from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from app.services.rag import query as rag_query, list_categories
from app.services.llm import generate_answer, detect_category, is_off_topic
from app.services.translate import is_supported, SUPPORTED_LANGUAGES

router = APIRouter()


class ChatMessage(BaseModel):
    role:    str
    content: str


class ChatRequest(BaseModel):
    message:        str               = Field(..., min_length=1, max_length=2000)
    language:       str               = Field("en", description="Target language code")
    simplify:       bool              = Field(True, description="Use plain, simplified language")
    history:        list[ChatMessage] = Field(default=[], description="Last 3 exchanges for memory")
    vision_context: str | None        = Field(None, description="Context from image analysis")


class ChatResponse(BaseModel):
    reply:             str
    language:          str
    simplified:        bool
    detected_category: str | None
    sources:           list[str]


@router.post("/", response_model=ChatResponse)
async def chat(req: ChatRequest):
    # 1. Validate language
    lang = req.language.lower()
    if not is_supported(lang):
        lang = "en"

    # 2. Check if off-topic
    off_topic, refusal = is_off_topic(req.message, lang)
    if off_topic:
        return ChatResponse(
            reply=refusal,
            language=lang,
            simplified=req.simplify,
            detected_category=None,
            sources=[],
        )

    # 3. Detect category
    category = detect_category(req.message)
    print(f"[CHAT] Routing question to category: '{category}'")

    # 4. Retrieve relevant chunks with category filter
    context_chunks = rag_query(req.message, category=category)
    if not context_chunks:
        print("[CHAT] No chunks with category filter, retrying without filter...")
        context_chunks = rag_query(req.message, category=None)

    # 5. Add vision context if available
    if req.vision_context:
        context_chunks = [req.vision_context] + context_chunks

    print(f"[CHAT] Total chunks retrieved: {len(context_chunks)}")

    # 6. Keep last 3 exchanges for memory
    recent_history = req.history[-6:] if req.history else []

    # 7. Generate answer
    answer = generate_answer(
        question=req.message,
        context_chunks=context_chunks,
        language=lang,
        simplify=req.simplify,
        history=recent_history,
    )

    sources = ["uploaded document"] if context_chunks else []

    return ChatResponse(
        reply=answer,
        language=lang,
        simplified=req.simplify,
        detected_category=category,
        sources=sources,
    )


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
    return {"categories": list_categories()}