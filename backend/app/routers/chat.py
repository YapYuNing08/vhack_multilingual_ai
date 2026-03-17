from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from app.services.rag import query as rag_query
from app.services.llm import generate_answer
from app.services.translate import is_supported, SUPPORTED_LANGUAGES

router = APIRouter()

class ChatRequest(BaseModel):
    message:  str         = Field(..., min_length=1, max_length=2000)
    language: str         = Field("en", description="Target language code")
    simplify: bool        = Field(True,  description="Use plain, simplified language")

class ChatResponse(BaseModel):
    reply:     str
    language:  str
    simplified: bool
    sources:   list[str]
    source_type: str # 🚨 ADDED to support frontend UI

@router.post("/", response_model=ChatResponse)
async def chat(req: ChatRequest):
    lang = req.language.lower()
    if not is_supported(lang):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported language '{lang}'. Supported: {list(SUPPORTED_LANGUAGES.keys())}",
        )

    context_chunks = rag_query(req.message)
    
    # 🚨 Determine if this was a Web Search or Document Search
    source_type = "none"
    sources = []
    if context_chunks:
        if any("http" in c or "www" in c or "Forbes" in c for c in context_chunks):
            source_type = "web"
            sources = ["web search"]
        else:
            source_type = "document"
            sources = ["uploaded document"]

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
        source_type=source_type, # 🚨 Pass this to frontend
    )

@router.get("/languages")
def get_supported_languages():
    return {
        "languages": [
            {"code": code, "name": name}
            for code, name in SUPPORTED_LANGUAGES.items()
        ]
    }