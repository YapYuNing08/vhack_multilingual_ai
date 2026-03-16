from dotenv import load_dotenv
load_dotenv()  # This magically loads your .env file!

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import chat, upload

app = FastAPI(title="SilaSpeak API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chat.router, prefix="/chat")
app.include_router(upload.router, prefix="/upload")

@app.get("/")
def root():
    return {"status": "SilaSpeak API running ✅"}   