from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import chat, upload
from app.services.rag import preload_documents

app = FastAPI(title="SilaSpeak API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router, prefix="/chat")
app.include_router(upload.router, prefix="/upload")


# ✅ FIX 2: Pre-load official govt documents on startup
@app.on_event("startup")
async def startup_event():
    print("[Startup] 🚀 SilaSpeak API starting...")
    loaded = preload_documents("./data/documents")
    if loaded == 0:
        print("[Startup] ℹ️  No new documents to pre-load. Drop PDFs into data/documents/ to expand knowledge base.")
    else:
        print(f"[Startup] ✅ Pre-loaded {loaded} document(s) into knowledge base.")


@app.get("/")
def root():
    return {"status": "SilaSpeak API running ✅"}