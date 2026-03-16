import os
import uuid
import pdfplumber
import chromadb
from chromadb.config import Settings
from sentence_transformers import SentenceTransformer
from typing import List, Dict
from rank_bm25 import BM25Okapi

# ── Config ────────────────────────────────────────────────────────────────────
CHROMA_PATH   = os.getenv("CHROMA_PATH", "./chroma_db")
EMBED_MODEL   = os.getenv("EMBED_MODEL", "all-MiniLM-L6-v2")
CHUNK_SIZE    = 1000
CHUNK_OVERLAP = 150
TOP_K         = 15   # ✅ FIX 1: Increased from 8 → 15 for broader coverage

# ── Singletons ────────────────────────────────────────────────────────────────
_embedder: SentenceTransformer | None = None
_collection = None
_all_chunks: List[str] = []   # ✅ FIX 4: In-memory store for BM25 hybrid search


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


# ── FIX 2: Pre-load official documents at startup ─────────────────────────────
def preload_documents(docs_folder: str = "./data/documents") -> int:
    """
    Ingest all PDFs in docs_folder into ChromaDB at startup.
    Returns the number of documents loaded.
    Skips documents already ingested (checks by filename in metadata).
    """
    if not os.path.exists(docs_folder):
        print(f"[RAG] Pre-load folder '{docs_folder}' not found, skipping.")
        return 0

    collection = _get_collection()

    # Get already-ingested filenames to avoid duplicates
    existing = collection.get(include=["metadatas"])
    ingested_files = {m["source"] for m in existing.get("metadatas", []) if m}

    loaded = 0
    for filename in os.listdir(docs_folder):
        if not filename.lower().endswith(".pdf"):
            continue
        if filename in ingested_files:
            print(f"[RAG] ⏭️  Already ingested: {filename}")
            continue
        filepath = os.path.join(docs_folder, filename)
        with open(filepath, "rb") as f:
            result = ingest(file_bytes=f.read(), filename=filename)
        if result["status"] == "success":
            print(f"[RAG] ✅ Pre-loaded: {filename} ({result['chunks_stored']} chunks)")
            loaded += 1
        else:
            print(f"[RAG] ❌ Failed: {filename} — {result.get('message')}")

    return loaded

# ── FIX 3: Web search fallback
def web_search_fallback(question: str, max_results: int = 4) -> List[str]:
    """
    Use DuckDuckGo to find relevant context when RAG returns nothing.
    Appends 'Malaysia' to bias toward local sources.
    """
    try:
        from ddgs import DDGS # 🚨 UPDATED IMPORT
        query_str = f"{question} Malaysia"
        
        with DDGS() as ddgs:
            # 🚨 UPDATED: Cast the generator to a list
            results = list(ddgs.text(query_str, max_results=max_results))
            
        chunks = [r.get("body", "") for r in results if r.get("body")]
        print(f"[RAG] 🌐 Web fallback: {len(chunks)} results for '{question}'")
        return chunks
    except Exception as e:
        print(f"[RAG] ⚠️  Web fallback failed: {e}")
        return []


# ── FIX 4: BM25 keyword search ────────────────────────────────────────────────
def _bm25_search(question: str, chunks: List[str], top_k: int) -> List[str]:
    """Keyword-based BM25 retrieval over a list of chunks."""
    if not chunks:
        return []
    tokenized = [c.lower().split() for c in chunks]
    bm25 = BM25Okapi(tokenized)
    scores = bm25.get_scores(question.lower().split())
    
    # 🚨 THE UPGRADE: Added a threshold (score > 1.0) to drop irrelevant keyword matches
    top_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:top_k]
    return [chunks[i] for i in top_indices if scores[i] > 1.0]


def _hybrid_merge(semantic: List[str], keyword: List[str], top_k: int) -> List[str]:
    """Merge semantic + BM25 results, deduplicate, preserve order."""
    seen = set()
    merged = []
    for chunk in semantic + keyword:
        if chunk not in seen:
            seen.add(chunk)
            merged.append(chunk)
    return merged[:top_k]


# ── Public API ────────────────────────────────────────────────────────────────
def ingest(file_bytes: bytes, filename: str) -> Dict:
    """Ingest a PDF into ChromaDB and update the in-memory BM25 store."""
    global _all_chunks

    raw_text = _extract_text_from_pdf(file_bytes)
    if not raw_text.strip():
        return {"status": "error", "message": "No text could be extracted from the PDF."}

    chunks     = _chunk_text(raw_text)
    embedder   = _get_embedder()
    embeddings = embedder.encode(chunks, show_progress_bar=False).tolist()
    collection = _get_collection()

    doc_id    = str(uuid.uuid4())[:8]
    ids       = [f"{doc_id}_{i}" for i in range(len(chunks))]
    metadatas = [{"source": filename, "chunk_index": i} for i in range(len(chunks))]

    collection.add(
        ids=ids,
        embeddings=embeddings,
        documents=chunks,
        metadatas=metadatas,
    )

    # ✅ FIX 4: Keep all chunks in memory for BM25
    _all_chunks.extend(chunks)

    return {
        "status": "success",
        "filename": filename,
        "chunks_stored": len(chunks),
        "doc_id": doc_id,
    }


def query(question: str, top_k: int = TOP_K) -> List[str]:
    """
    Retrieve the most relevant chunks using hybrid search (semantic + BM25).
    Falls back to web search if the knowledge base is empty or returns nothing.
    """
    collection = _get_collection()

    # ── Step 1: Semantic search via ChromaDB ──────────────────────────────
    semantic_chunks: List[str] = []
    if collection.count() > 0:
        embedder           = _get_embedder()
        question_embedding = embedder.encode([question], show_progress_bar=False).tolist()
        results            = collection.query(
            query_embeddings=question_embedding,
            n_results=min(top_k, collection.count()),
            include=["documents", "metadatas", "distances"],
        )
        raw_chunks = results.get("documents", [[]])[0]
        distances = results.get("distances", [[]])[0]

        # Let's print the scores so you can calibrate them!
        print("\n[RAG] --- CHROMA DB DISTANCE SCORES ---")
        for i, dist in enumerate(distances):
              print(f"Chunk {i+1}: Distance {dist:.3f}")
        print("---------------------------------------\n")

        # THE FIX: Tightened threshold from 0.8 to 0.55
        semantic_chunks = [chunk for chunk, dist in zip(raw_chunks, distances) if dist < 0.55]

    # ── Step 2: BM25 keyword search ───────────────────────────────────────
    keyword_chunks = _bm25_search(question, _all_chunks, top_k)

    # ── Step 3: Merge hybrid results ──────────────────────────────────────
    merged = _hybrid_merge(semantic_chunks, keyword_chunks, top_k)

    # ── Step 4: Web fallback if still empty ───────────────────────────────
    if not merged:
        print("[RAG] 📭 Knowledge base returned no relevant matches — triggering web search fallback.")
        merged = web_search_fallback(question)

    print(f"[RAG] Retrieved {len(merged)} chunks "
          f"(semantic={len(semantic_chunks)}, bm25={len(keyword_chunks)})")

    return merged