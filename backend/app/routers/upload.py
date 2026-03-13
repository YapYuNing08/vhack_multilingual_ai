from fastapi import APIRouter, UploadFile, File

# This is the 'router' variable that main.py is looking for!
router = APIRouter()

@router.post("/")
async def upload_document(file: UploadFile = File(...)):
    """
    This endpoint will be used to upload official government PDFs
    for the RAG pipeline later.
    """
    return {"filename": file.filename, "message": "File uploaded successfully"}