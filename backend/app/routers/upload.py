from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from app.services.rag import ingest

# ── Try to import KNOWN_CATEGORIES (from second code) ────────────────────────
# Gracefully degrade if not yet defined in llm.py
try:
    from app.services.llm import KNOWN_CATEGORIES
    HAS_CATEGORIES = True
except ImportError:
    KNOWN_CATEGORIES = {
        "education", "health", "tax", "welfare", "housing",
        "employment", "legal", "transport", "environment", "general"
    }
    HAS_CATEGORIES = False

router = APIRouter()

# ✅ First code: 50MB limit (more generous for large government PDFs)
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB


@router.post("/")
async def upload_document(
    file:     UploadFile = File(...),
    # ✅ Second code: optional category tagging for smarter RAG retrieval
    category: str        = Form(default="general"),
):
    """
    Upload a PDF document and ingest it into the RAG pipeline.
    The document will be chunked, embedded, and stored in ChromaDB.

    Optional category parameter improves retrieval accuracy:
    education, health, tax, welfare, housing,
    employment, legal, transport, environment, general

    Automatically uses OCR (Groq Vision) if the PDF has no text layer.
    """
    # 1. Validate file type
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    # 2. Normalise and validate category
    category = category.lower().strip()
    if category not in KNOWN_CATEGORIES:
        category = "general"

    # 3. Read file bytes
    file_bytes = await file.read()

    # 4. Validate file size (50MB from first code)
    if len(file_bytes) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {MAX_FILE_SIZE // (1024 * 1024)} MB.",
        )

    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    # 5. Ingest into RAG pipeline
    # Pass category if supported by the ingest function, else fall back gracefully
    try:
        result = ingest(file_bytes=file_bytes, filename=file.filename, category=category)
    except TypeError:
        # ingest() doesn't accept category yet — call without it
        result = ingest(file_bytes=file_bytes, filename=file.filename)
        result["category"] = category  # tag it manually for the response

    if result["status"] == "error":
        raise HTTPException(status_code=422, detail=result["message"])

    # 6. Build response message
    extraction_method = result.get("extraction_method", "")
    if extraction_method == "text_layer":
        method_msg = "Text extracted directly."
    elif extraction_method in ("ocr", "vision"):
        method_msg = "Scanned PDF detected — OCR was used to extract text."
    else:
        method_msg = ""

    return {
        "status":            "success",
        "filename":          result["filename"],
        "category":          result.get("category", category),
        "chunks_stored":     result["chunks_stored"],
        "extraction_method": extraction_method or "unknown",
        "message":           (
            f"✅ '{file.filename}' ingested as '{category}'. "
            f"{result['chunks_stored']} chunks stored. {method_msg}"
        ).strip(),
    }


@router.get("/categories")
def get_categories():
    """Returns the valid category tags for document ingestion."""
    return {"valid_categories": sorted(KNOWN_CATEGORIES)}