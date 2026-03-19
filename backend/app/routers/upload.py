from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from app.services.rag import ingest
from app.services.llm import KNOWN_CATEGORIES

router = APIRouter()

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


@router.post("/")
async def upload_document(
    file:     UploadFile = File(...),
    category: str        = Form(default="general"),
):
    """
    Upload a PDF and ingest it into the RAG pipeline.
    Automatically uses OCR (Groq Vision) if the PDF has no text layer.
    Categories: education, health, tax, welfare, housing,
                employment, legal, transport, environment, general
    """
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    category = category.lower().strip()
    if category not in KNOWN_CATEGORIES:
        category = "general"

    file_bytes = await file.read()
    if len(file_bytes) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Max size is {MAX_FILE_SIZE // (1024*1024)} MB.",
        )
    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    result = ingest(file_bytes=file_bytes, filename=file.filename, category=category)

    if result["status"] == "error":
        raise HTTPException(status_code=422, detail=result["message"])

    method_msg = (
        "Text extracted directly."
        if result.get("extraction_method") == "text_layer"
        else "Scanned PDF detected — OCR was used to extract text."
    )

    return {
        "status":            "success",
        "filename":          result["filename"],
        "category":          result["category"],
        "chunks_stored":     result["chunks_stored"],
        "extraction_method": result.get("extraction_method", "unknown"),
        "message":           f"'{file.filename}' ingested as '{category}'. {result['chunks_stored']} chunks stored. {method_msg}",
    }


@router.get("/categories")
def get_categories():
    return {"valid_categories": KNOWN_CATEGORIES}