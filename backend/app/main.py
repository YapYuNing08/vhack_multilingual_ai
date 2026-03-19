from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# FIX 1: Imported 'vision' right here
from app.routers import chat, upload, vision, transcribe 
from app.services.rag import preload_documents 

# FIX 2: Create the 'app' FIRST
app = FastAPI(title="SilaSpeak API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# FIX 3: Attach the routers AFTER the app exists
app.include_router(chat.router, prefix="/chat")
app.include_router(upload.router, prefix="/upload")
app.include_router(vision.router, prefix="/vision")
app.include_router(transcribe.router, prefix="/transcribe")

@app.on_event("startup")
async def startup_event():
    print("[Startup] 🚀 SilaSpeak API starting...")
    loaded = preload_documents("./data/documents")
    if loaded == 0:
        print("[Startup] ℹ️  No new documents to pre-load. Drop PDFs into data/documents/.")
    else:
        print(f"[Startup] ✅ Pre-loaded {loaded} document(s) into knowledge base.")

@app.get("/")
def root():
    return {"status": "SilaSpeak API running ✅"}