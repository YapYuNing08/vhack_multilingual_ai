import os
import uuid
import pdfplumber
import chromadb
from chromadb.config import Settings
from sentence_transformers import SentenceTransformer
from typing import List, Dict
from rank_bm25 import BM25Okapi # 🚨 ADDED

# ── Config ────────────────────────────────────────────────────────────────────
CHROMA_PATH   = os.getenv("CHROMA_PATH", "./chroma_db")
EMBED_MODEL   = os.getenv("EMBED_MODEL", "all-MiniLM-L6-v2")
CHUNK_SIZE    = 1000
CHUNK_OVERLAP = 150
TOP_K         = 15   # 🚨 APPROACH 1: Increased to 15

# ── Singletons ────────────────────────────────────────────────────────────────
_embedder: SentenceTransformer | None = None
_collection = None
_all_chunks: List[str] = []   # 🚨 ADDED: For BM25 Hybrid Search

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
    import io
    text_parts = []
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text_parts.append(page_text.strip())
    return "\n\n".join(text_parts)

def _chunk_text(text: str) -> List[str]:
    chunks = []
    start = 0
    while start < len(text):
        end = start + CHUNK_SIZE
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        start += CHUNK_SIZE - CHUNK_OVERLAP
    return chunks

# ── APPROACH 2: Pre-load Documents ────────────────────────────────────────────
def preload_documents(docs_folder: str = "./data/documents") -> int:
    if not os.path.exists(docs_folder):
        return 0
    collection = _get_collection()
    existing = collection.get(include=["metadatas"])
    ingested_files = {m["source"] for m in existing.get("metadatas", []) if m}
    loaded = 0
    for filename in os.listdir(docs_folder):
        if not filename.lower().endswith(".pdf"):
            continue
        if filename in ingested_files:
            continue
        filepath = os.path.join(docs_folder, filename)
        with open(filepath, "rb") as f:
            result = ingest(file_bytes=f.read(), filename=filename)
        if result["status"] == "success":
            loaded += 1
    return loaded

# ── APPROACH 3: Web Search Fallback ───────────────────────────────────────────
def web_search_fallback(question: str, max_results: int = 4) -> List[str]:
    try:
        from ddgs import DDGS
        query_str = f"{question} Malaysia"
        with DDGS() as ddgs:
            results = list(ddgs.text(query_str, max_results=max_results))
        chunks = [r.get("body", "") for r in results if r.get("body")]
        print(f"[RAG] 🌐 Web fallback: {len(chunks)} results")
        return chunks
    except Exception as e:
        print(f"[RAG] ⚠️ Web fallback failed: {e}")
        return []

# ── APPROACH 4: Hybrid Search (BM25) ──────────────────────────────────────────
def _bm25_search(question: str, chunks: List[str], top_k: int) -> List[str]:
    if not chunks:
        return []
    tokenized = [c.lower().split() for c in chunks]
    bm25 = BM25Okapi(tokenized)
    scores = bm25.get_scores(question.lower().split())
    top_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:top_k]
    return [chunks[i] for i in top_indices if scores[i] > 1.0]

def _hybrid_merge(semantic: List[str], keyword: List[str], top_k: int) -> List[str]:
    seen = set()
    merged = []
    for chunk in semantic + keyword:
        if chunk not in seen:
            seen.add(chunk)
            merged.append(chunk)
    return merged[:top_k]

# ── Public API ────────────────────────────────────────────────────────────────
def ingest(file_bytes: bytes, filename: str) -> Dict:
    global _all_chunks
    raw_text = _extract_text_from_pdf(file_bytes)
    if not raw_text.strip():
        return {"status": "error", "message": "No text extracted."}
    chunks = _chunk_text(raw_text)
    embedder = _get_embedder()
    embeddings = embedder.encode(chunks, show_progress_bar=False).tolist()
    collection = _get_collection()
    doc_id = str(uuid.uuid4())[:8]
    ids = [f"{doc_id}_{i}" for i in range(len(chunks))]
    metadatas = [{"source": filename, "chunk_index": i} for i in range(len(chunks))]
    collection.add(ids=ids, embeddings=embeddings, documents=chunks, metadatas=metadatas)
    
    _all_chunks.extend(chunks) # Store for BM25
    return {"status": "success", "filename": filename, "chunks_stored": len(chunks), "doc_id": doc_id}

def query(question: str, top_k: int = TOP_K) -> List[str]:
    collection = _get_collection()
    semantic_chunks: List[str] = []
    
    # 1. Semantic Search with strict threshold
    if collection.count() > 0:
        embedder = _get_embedder()
        question_embedding = embedder.encode([question], show_progress_bar=False).tolist()
        results = collection.query(
            query_embeddings=question_embedding,
            n_results=min(top_k, collection.count()),
            include=["documents", "metadatas", "distances"],
        )
        raw_chunks = results.get("documents", [[]])[0]
        distances = results.get("distances", [[]])[0]
        # 🚨 Strict threshold to dump bad matches
        semantic_chunks = [chunk for chunk, dist in zip(raw_chunks, distances) if dist < 0.55]

    # 2. Keyword Search
    keyword_chunks = _bm25_search(question, _all_chunks, top_k)

    # 3. Merge
    merged = _hybrid_merge(semantic_chunks, keyword_chunks, top_k)

    # 4. Web Fallback
    if not merged:
        print("[RAG] 📭 Knowledge base empty — triggering web search fallback.")
        merged = web_search_fallback(question)

    return merged