from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from app.services.vision import analyze_document_image

router = APIRouter()

@router.post("/")
async def snap_and_translate(
    file: UploadFile = File(...),
    language: str = Form("en")
):
    """
    Accepts an image upload of a document and a target language.
    Returns a simplified explanation of the document.
    """
    # Validate it's an image
    if not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=400, 
            detail="Invalid file type. Please upload an image (JPEG, PNG)."
        )

    # Read the image file
    image_bytes = await file.read()

    # Prevent massive files (Limit to 5MB for Vision)
    if len(image_bytes) > 5 * 1024 * 1024:
        raise HTTPException(
            status_code=413, 
            detail="Image is too large. Please keep it under 5MB."
        )

    # Send to the Vision Service
    explanation = analyze_document_image(image_bytes, language)

    return {
        "status": "success",
        "language": language,
        "explanation": explanation
    }