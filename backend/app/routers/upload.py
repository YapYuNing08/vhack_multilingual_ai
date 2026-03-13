from fastapi import APIRouter, UploadFile, File, HTTPException
from app.services.rag import ingest

router = APIRouter()

ALLOWED_TYPES = {"application/pdf", "application/octet-stream"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB


@router.post("/")
async def upload_document(file: UploadFile = File(...)):
    """
    Upload a PDF document and ingest it into the RAG pipeline.
    The document will be chunked, embedded, and stored in ChromaDB.
    """
    # 1. Validate file type
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail="Only PDF files are supported.",
        )

    # 2. Read file bytes
    file_bytes = await file.read()

    # 3. Validate file size
    if len(file_bytes) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {MAX_FILE_SIZE // (1024*1024)} MB.",
        )

    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    # 4. Ingest into RAG pipeline
    result = ingest(file_bytes=file_bytes, filename=file.filename)

    if result["status"] == "error":
        raise HTTPException(status_code=422, detail=result["message"])

    return {
        "status": "success",
        "filename": result["filename"],
        "chunks_stored": result["chunks_stored"],
        "message": f"✅ '{file.filename}' ingested successfully. {result['chunks_stored']} chunks stored.",
    }