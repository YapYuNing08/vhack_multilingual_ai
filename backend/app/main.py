from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import chat, upload, vision, transcribe, form
from app.services.rag import preload_documents

app = FastAPI(title="SilaSpeak API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router,       prefix="/chat")
app.include_router(upload.router,     prefix="/upload")
app.include_router(vision.router,     prefix="/vision")
app.include_router(transcribe.router, prefix="/transcribe")
app.include_router(form.router,       prefix="/form")

@app.on_event("startup")
async def startup_event():
    print("[Startup] SilaSpeak API starting...")
    loaded = preload_documents("./data/documents")
    if loaded == 0:
        print("[Startup] No new documents to pre-load.")
    else:
        print(f"[Startup] Pre-loaded {loaded} document(s).")

@app.get("/")
def root():
    return {"status": "SilaSpeak API running"}