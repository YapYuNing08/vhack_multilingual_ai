import os
import uuid
import pdfplumber
import chromadb
from chromadb.config import Settings
from sentence_transformers import SentenceTransformer
from typing import List, Dict

# ── Config ────────────────────────────────────────────────────────────────────
CHROMA_PATH = os.getenv("CHROMA_PATH", "./chroma_db")
EMBED_MODEL  = os.getenv("EMBED_MODEL", "all-MiniLM-L6-v2")   # fast & free
CHUNK_SIZE   = 500    # characters per chunk
CHUNK_OVERLAP = 80    # overlap between chunks
TOP_K        = 4      # number of chunks to retrieve per query

# ── Singletons (loaded once on startup) ───────────────────────────────────────
_embedder: SentenceTransformer | None = None
_collection = None


def _get_embedder() -> SentenceTransformer:
    global _embedder
    if _embedder is None:
        print("[RAG] Loading embedding model...")
        _embedder = SentenceTransformer(EMBED_MODEL)
    return _embedder


def _get_collection():
    global _collection
    if _collection is None:
        client = chromadb.PersistentClient(
            path=CHROMA_PATH,
            settings=Settings(anonymized_telemetry=False),
        )
        _collection = client.get_or_create_collection(
            name="silaspeak_docs",
            metadata={"hnsw:space": "cosine"},
        )
    return _collection


# ── Helpers ───────────────────────────────────────────────────────────────────
def _extract_text_from_pdf(file_bytes: bytes) -> str:
    """Extract all text from a PDF given its raw bytes."""
    import io
    text_parts = []
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text_parts.append(page_text.strip())
    return "\n\n".join(text_parts)


def _chunk_text(text: str) -> List[str]:
    """Split text into overlapping chunks."""
    chunks = []
    start = 0
    while start < len(text):
        end = start + CHUNK_SIZE
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start += CHUNK_SIZE - CHUNK_OVERLAP
    return chunks


# ── Public API ────────────────────────────────────────────────────────────────
def ingest(file_bytes: bytes, filename: str) -> Dict:
    """
    Ingest a PDF document into ChromaDB.
    Returns a summary dict with chunk count.
    """
    # 1. Extract text
    raw_text = _extract_text_from_pdf(file_bytes)
    if not raw_text.strip():
        return {"status": "error", "message": "No text could be extracted from the PDF."}

    # 2. Chunk
    chunks = _chunk_text(raw_text)

    # 3. Embed
    embedder = _get_embedder()
    embeddings = embedder.encode(chunks, show_progress_bar=False).tolist()

    # 4. Store in ChromaDB
    collection = _get_collection()
    doc_id = str(uuid.uuid4())[:8]   # short unique prefix for this document

    ids       = [f"{doc_id}_{i}" for i in range(len(chunks))]
    metadatas = [{"source": filename, "chunk_index": i} for i in range(len(chunks))]

    collection.add(
        ids=ids,
        embeddings=embeddings,
        documents=chunks,
        metadatas=metadatas,
    )

    return {
        "status": "success",
        "filename": filename,
        "chunks_stored": len(chunks),
        "doc_id": doc_id,
    }


def query(question: str, top_k: int = TOP_K) -> List[str]:
    """
    Retrieve the most relevant text chunks for a question.
    Returns a list of chunk strings.
    """
    collection = _get_collection()

    if collection.count() == 0:
        return []

    embedder = _get_embedder()
    question_embedding = embedder.encode([question], show_progress_bar=False).tolist()

    results = collection.query(
        query_embeddings=question_embedding,
        n_results=min(top_k, collection.count()),
        include=["documents", "metadatas"],
    )

    chunks = results.get("documents", [[]])[0]
    return chunks