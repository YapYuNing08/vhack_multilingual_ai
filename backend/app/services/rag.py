import os
import io
import uuid
import base64
import pdfplumber
import chromadb
from chromadb.config import Settings
from sentence_transformers import SentenceTransformer
from typing import List, Dict, Optional
from rank_bm25 import BM25Okapi

# ── Config ────────────────────────────────────────────────────────────────────
CHROMA_PATH   = os.getenv("CHROMA_PATH", "./chroma_db")
EMBED_MODEL   = os.getenv("EMBED_MODEL", "all-MiniLM-L6-v2")
CHUNK_SIZE    = 1000
CHUNK_OVERLAP = 150
TOP_K         = 15   # ✅ First code: 15 (second had 8)

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


# ══════════════════════════════════════════════════════════════════════════════
# TEXT EXTRACTION — from second code
# Smart 3-step: text layer → Groq Vision OCR → error
# ══════════════════════════════════════════════════════════════════════════════

def _extract_text_pdfplumber(file_bytes: bytes) -> str:
    text_parts = []
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text_parts.append(page_text.strip())
    return "\n\n".join(text_parts)


def _pdf_pages_to_base64_images(file_bytes: bytes) -> List[str]:
    try:
        from pdf2image import convert_from_bytes
        images = convert_from_bytes(file_bytes, dpi=150, fmt="png")
        result = []
        for img in images:
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            result.append(base64.b64encode(buf.getvalue()).decode("utf-8"))
        return result
    except Exception as e:
        print(f"[RAG] pdf2image failed: {e} — trying pdfplumber render")
        return _extract_embedded_images_as_base64(file_bytes)


def _extract_embedded_images_as_base64(file_bytes: bytes) -> List[str]:
    result = []
    try:
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            for page in pdf.pages:
                img = page.to_image(resolution=150)
                buf = io.BytesIO()
                img.save(buf, format="PNG")
                result.append(base64.b64encode(buf.getvalue()).decode("utf-8"))
    except Exception as e:
        print(f"[RAG] Image extraction failed: {e}")
    return result


def _extract_text_groq_vision(file_bytes: bytes) -> str:
    """Use Groq Vision (Llama 4 Scout) to OCR scanned PDF pages."""
    from groq import Groq
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        return ""

    client = Groq(api_key=api_key)
    print("[RAG] Text layer empty — using Groq Vision OCR...")

    page_images = _pdf_pages_to_base64_images(file_bytes)
    if not page_images:
        return ""

    all_text = []
    for i, b64_image in enumerate(page_images):
        print(f"[RAG] Vision OCR: page {i+1}/{len(page_images)}...")
        try:
            response = client.chat.completions.create(
                model="meta-llama/llama-4-scout-17b-16e-instruct",
                messages=[{
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": (
                                "Please extract ALL text from this document image. "
                                "Preserve the structure, headings, bullet points, and numbers. "
                                "Output only the extracted text, nothing else."
                            )
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/png;base64,{b64_image}"}
                        }
                    ]
                }],
                max_tokens=4096,
            )
            page_text = response.choices[0].message.content.strip()
            if page_text:
                all_text.append(page_text)
        except Exception as e:
            print(f"[RAG] Vision OCR failed on page {i+1}: {e}")

    return "\n\n".join(all_text)


def extract_text_from_pdf(file_bytes: bytes) -> tuple[str, str]:
    """
    Smart 3-step extraction:
    1. Direct text layer (fast, free)
    2. Groq Vision OCR (for scanned PDFs)
    3. Error if both fail
    Returns (text, method) — method is 'text_layer' | 'vision_ocr' | 'failed'
    """
    text  = _extract_text_pdfplumber(file_bytes)
    clean = text.strip().replace("\n", "").replace(" ", "")
    if len(clean) >= 100:
        print(f"[RAG] ✅ Text layer: {len(text)} chars")
        return text, "text_layer"

    print(f"[RAG] ⚠️  Text layer insufficient ({len(clean)} chars) → Groq Vision OCR")
    ocr_text = _extract_text_groq_vision(file_bytes)
    if ocr_text.strip():
        print(f"[RAG] ✅ Vision OCR: {len(ocr_text)} chars")
        return ocr_text, "vision_ocr"

    return "", "failed"


# ── Chunking ──────────────────────────────────────────────────────────────────
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

    collection     = _get_collection()
    existing       = collection.get(include=["metadatas"])
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


# ── Web search fallback — from first code ─────────────────────────────────────
def _translate_to_english(text: str) -> str:
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
        return text


def web_search_fallback(question: str, max_results: int = 5) -> List[str]:
    """DuckDuckGo fallback when RAG returns nothing. Translates to English first."""
    try:
        from ddgs import DDGS
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


# ══════════════════════════════════════════════════════════════════════════════
# PUBLIC API
# ══════════════════════════════════════════════════════════════════════════════

def ingest(file_bytes: bytes, filename: str, category: str = "general") -> Dict:
    """
    Ingest a PDF into ChromaDB.
    ✅ Smart OCR fallback: text layer first, then Groq Vision for scanned PDFs
    ✅ Category tagging: stored in metadata for filtered retrieval
    ✅ Deduplication: removes old chunks before re-ingesting same file
    """
    global _all_chunks

    raw_text, method = extract_text_from_pdf(file_bytes)
    if not raw_text.strip():
        return {
            "status":  "error",
            "message": "Could not extract text. File may be encrypted, corrupted, or unsupported.",
        }

    chunks     = _chunk_text(raw_text)
    embedder   = _get_embedder()
    embeddings = embedder.encode(chunks, show_progress_bar=False).tolist()
    collection = _get_collection()

    # ✅ Deduplication: remove old chunks for same filename
    try:
        existing = collection.get(where={"source": {"$eq": filename}})
        if existing["ids"]:
            collection.delete(ids=existing["ids"])
            print(f"[RAG] 🔄 Replaced {len(existing['ids'])} old chunks for '{filename}'")
    except Exception as e:
        print(f"[RAG] Dedup skipped: {e}")

    doc_id    = str(uuid.uuid4())[:8]
    ids       = [f"{doc_id}_{i}" for i in range(len(chunks))]
    metadatas = [
        {
            "source":      filename,
            "category":    category.lower().strip(),
            "chunk_index": i,
            "doc_id":      doc_id,
            "method":      method,
        }
        for i in range(len(chunks))
    ]

    collection.add(ids=ids, embeddings=embeddings, documents=chunks, metadatas=metadatas)
    _all_chunks.extend(chunks)

    print(f"[RAG] ✅ '{filename}' | method={method} | category='{category}' | {len(chunks)} chunks")

    return {
        "status":            "success",
        "filename":          filename,
        "category":          category,
        "chunks_stored":     len(chunks),
        "extraction_method": method,
        "doc_id":            doc_id,
    }


def query(question: str, category: Optional[str] = None, top_k: int = TOP_K) -> List[str]:
    """
    Hybrid search: semantic (ChromaDB) + keyword (BM25).
    ✅ Category filter: narrows search to relevant documents
    ✅ English translation for embedding: better similarity scores
    ✅ Distance threshold 0.55: from first code
    ✅ Web fallback: DuckDuckGo when knowledge base returns nothing
    """
    collection = _get_collection()
    semantic_chunks: List[str] = []

    if collection.count() > 0:
        embedder = _get_embedder()

        # ✅ Translate to English for better embedding similarity
        english_question   = _translate_to_english(question)
        question_embedding = embedder.encode([english_question], show_progress_bar=False).tolist()

        # ✅ Apply category filter if provided
        where_filter = {"category": {"$eq": category.lower().strip()}} if category else None

        try:
            results = collection.query(
                query_embeddings=question_embedding,
                n_results=min(top_k, collection.count()),
                include=["documents", "metadatas", "distances"],
                where=where_filter,
            )
        except Exception as e:
            print(f"[RAG] Filtered query failed ({e}) — retrying without filter")
            results = collection.query(
                query_embeddings=question_embedding,
                n_results=min(top_k, collection.count()),
                include=["documents", "metadatas", "distances"],
            )

        raw_chunks = results.get("documents", [[]])[0]
        distances  = results.get("distances",  [[]])[0]
        metas      = results.get("metadatas",  [[]])[0]

        print("\n[RAG] --- CHROMA DISTANCES ---")
        for i, d in enumerate(distances):
            print(f"  Chunk {i+1}: {d:.3f}")
        print("-----------------------------\n")

        # ✅ Distance threshold from first code
        semantic_chunks = [c for c, d in zip(raw_chunks, distances) if d < 0.55]

        if metas:
            print(f"[RAG] Sources: {set(m.get('source','?') for m in metas)}")

    keyword_chunks = _bm25_search(question, _all_chunks, top_k)
    merged         = _hybrid_merge(semantic_chunks, keyword_chunks, top_k)

    if not merged:
        print("[RAG] 📭 No matches — triggering web search fallback.")
        merged = web_search_fallback(question)

    print(f"[RAG] Retrieved {len(merged)} chunks "
          f"(semantic={len(semantic_chunks)}, bm25={len(keyword_chunks)}, filter={category})")

    return merged


def list_categories() -> List[str]:
    """✅ From second code: list all document categories stored in ChromaDB."""
    collection = _get_collection()
    if collection.count() == 0:
        return []
    all_items = collection.get(include=["metadatas"])
    cats = set()
    for m in all_items.get("metadatas", []):
        if m and "category" in m:
            cats.add(m["category"])
    return sorted(list(cats))