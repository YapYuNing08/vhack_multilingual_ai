from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

class ChatRequest(BaseModel):
    message: str
    language: str = "en"  # target language code

@router.post("/")
async def chat(req: ChatRequest):
    # TODO: wire up RAG + translate + simplify
    return {
        "reply": f"Echo: {req.message}",
        "language": req.language,
        "simplified": True
    }