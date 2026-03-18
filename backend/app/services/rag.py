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
TOP_K         = 15

# ── Singletons ────────────────────────────────────────────────────────────────
_embedder: SentenceTransformer | None = None
_collection = None
_all_chunks: List[str] = []


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


# ── Pre-load official documents at startup ────────────────────────────────────
def preload_documents(docs_folder: str = "./data/documents") -> int:
    if not os.path.exists(docs_folder):
        print(f"[RAG] Pre-load folder '{docs_folder}' not found, skipping.")
        return 0

    collection = _get_collection()
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


# ── Web search fallback ───────────────────────────────────────────────────────
def _translate_to_english(text: str) -> str:
    """
    Translate a non-English question to English for better web search results.
    Uses a tiny LLM call — only triggered when web fallback is needed.
    """
    try:
        from app.services.llm import _get_client, GROQ_MODEL
        client = _get_client()
        result = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Translate the user's message to English. "
                        "Return ONLY the English translation, nothing else. "
                        "If it is already English, return it unchanged."
                    ),
                },
                {"role": "user", "content": text},
            ],
            temperature=0.0,
            max_tokens=100,
        )
        return result.choices[0].message.content.strip()
    except Exception:
        return text  # fallback: use original


def web_search_fallback(question: str, max_results: int = 5) -> List[str]:
    """
    Search DuckDuckGo for relevant context when RAG returns nothing.

    FIX: Translates the question to English first (web search works better
    with English queries), then appends 'Malaysia official' to bias toward
    authoritative government sources rather than general web content.
    """
    try:
        from ddgs import DDGS

        # Translate to English for better search accuracy
        english_question = _translate_to_english(question)
        query_str = f"{english_question} Malaysia official government"
        print(f"[RAG] 🌐 Web search query: '{query_str}'")

        with DDGS() as ddgs:
            results = list(ddgs.text(query_str, max_results=max_results))

        chunks = [r.get("body", "") for r in results if r.get("body")]
        print(f"[RAG] 🌐 Web fallback: {len(chunks)} results")
        return chunks
    except Exception as e:
        print(f"[RAG] ⚠️  Web fallback failed: {e}")
        return []


# ── BM25 keyword search ───────────────────────────────────────────────────────
def _bm25_search(question: str, chunks: List[str], top_k: int) -> List[str]:
    if not chunks:
        return []
    tokenized = [c.lower().split() for c in chunks]
    bm25      = BM25Okapi(tokenized)
    scores    = bm25.get_scores(question.lower().split())
    top_idx   = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:top_k]
    return [chunks[i] for i in top_idx if scores[i] > 1.0]


def _hybrid_merge(semantic: List[str], keyword: List[str], top_k: int) -> List[str]:
    seen, merged = set(), []
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

    chunks     = _chunk_text(raw_text)
    embedder   = _get_embedder()
    embeddings = embedder.encode(chunks, show_progress_bar=False).tolist()
    collection = _get_collection()

    doc_id    = str(uuid.uuid4())[:8]
    ids       = [f"{doc_id}_{i}" for i in range(len(chunks))]
    metadatas = [{"source": filename, "chunk_index": i} for i in range(len(chunks))]

    collection.add(ids=ids, embeddings=embeddings, documents=chunks, metadatas=metadatas)
    _all_chunks.extend(chunks)

    return {"status": "success", "filename": filename, "chunks_stored": len(chunks), "doc_id": doc_id}


def query(question: str, top_k: int = TOP_K) -> List[str]:
    """
    Hybrid search: semantic (ChromaDB) + keyword (BM25).
    Falls back to web search if knowledge base returns nothing.

    FIX: Also translates non-English questions to English for embedding,
    since the embedding model (all-MiniLM-L6-v2) works best in English.
    """
    collection = _get_collection()
    semantic_chunks: List[str] = []

    if collection.count() > 0:
        embedder = _get_embedder()

        # Translate question to English for better embedding similarity
        english_question   = _translate_to_english(question)
        question_embedding = embedder.encode([english_question], show_progress_bar=False).tolist()

        results = collection.query(
            query_embeddings=question_embedding,
            n_results=min(top_k, collection.count()),
            include=["documents", "metadatas", "distances"],
        )
        raw_chunks = results.get("documents", [[]])[0]
        distances  = results.get("distances",  [[]])[0]

        print("\n[RAG] --- CHROMA DISTANCES ---")
        for i, d in enumerate(distances):
            print(f"  Chunk {i+1}: {d:.3f}")
        print("-----------------------------\n")

        semantic_chunks = [c for c, d in zip(raw_chunks, distances) if d < 0.55]

    keyword_chunks = _bm25_search(question, _all_chunks, top_k)
    merged         = _hybrid_merge(semantic_chunks, keyword_chunks, top_k)

    if not merged:
        print("[RAG] 📭 No matches — triggering web search fallback.")
        merged = web_search_fallback(question)

    print(f"[RAG] Retrieved {len(merged)} chunks "
          f"(semantic={len(semantic_chunks)}, bm25={len(keyword_chunks)})")

    return merged