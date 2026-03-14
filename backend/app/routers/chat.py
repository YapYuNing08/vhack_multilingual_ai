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
    sources:   list[str]  # filenames of retrieved source documents


@router.post("/", response_model=ChatResponse)
async def chat(req: ChatRequest):
    # 1. Validate language
    lang = req.language.lower()
    if not is_supported(lang):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported language '{lang}'. Supported: {list(SUPPORTED_LANGUAGES.keys())}",
        )

    # 2. Retrieve relevant chunks from ChromaDB
    
    context_chunks = rag_query(req.message)
    # --- ADD THIS DEBUG BLOCK ---
    print("\n" + "="*40)
    print(f"DEBUG: Found {len(context_chunks)} chunks!")
    for i, chunk in enumerate(context_chunks):
        print(f"\n--- CHUNK {i+1} ---")
        print(chunk)
    print("="*40 + "\n")
    # -----------------------------

    # 3. Generate grounded answer
    # 3. Generate grounded answer (includes translation + simplification via prompt)
    answer = generate_answer(
        question=req.message,
        context_chunks=context_chunks,
        language=lang,
        simplify=req.simplify,
    )

    # 4. Extract source filenames for transparency
    sources = []
    if context_chunks:
        # rag.query returns plain strings; sources tracked separately if needed
        # For now return a generic indicator — extend later with metadata
        sources = ["uploaded document"]

    return ChatResponse(
        reply=answer,
        language=lang,
        simplified=req.simplify,
        sources=sources,
    )


@router.get("/languages")
def get_supported_languages():
    """Return all supported languages for the frontend dropdown."""
    return {
        "languages": [
            {"code": code, "name": name}
            for code, name in SUPPORTED_LANGUAGES.items()
        ]
    }