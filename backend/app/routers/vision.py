from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from app.services.vision import analyze_document_image

router = APIRouter()


@router.post("/")
async def snap_and_translate(
    file: UploadFile = File(...),
    language: str = Form("en")
):
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Invalid file type. Please upload an image.")

    image_bytes = await file.read()

    if len(image_bytes) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image too large. Keep it under 5MB.")

    result = analyze_document_image(image_bytes, language)

    return {
        "status":            "success",
        "language":          language,
        "explanation":       result["explanation"],
        "scam_result":       result["scam_result"],
        "jargon":            result.get("jargon", {}),
        "suggested_subsidy": result.get("suggested_subsidy"),   # ✅ proactive subsidy
        "subsidy_reason":    result.get("subsidy_reason"),
    }