import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, UploadFile, File, HTTPException
from typing import Annotated

from app.models.schemas import DocumentInfo, UrlRequest
from app.services.chunking import chunk_text
from app.services.embedding import encode
from app.services.crawler import fetch_and_extract

router = APIRouter(prefix="/documents", tags=["documents"])


def _get_collection(app):
    return app.state.chroma_client.get_or_create_collection("logscope_kb")


@router.post("/upload", response_model=list[DocumentInfo])
async def upload_files(
    files: Annotated[list[UploadFile], File(description="Markdown or text files")],
):
    from app.main import app

    results = []
    for f in files:
        content = await f.read()
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError:
            raise HTTPException(400, f"File {f.filename} is not valid UTF-8 text")

        doc_id = uuid.uuid4().hex[:12]
        chunks = chunk_text(text)
        if not chunks:
            continue

        embeddings = encode(chunks)
        collection = _get_collection(app)
        now = datetime.now(timezone.utc).isoformat()

        ids = [f"{doc_id}_chunk_{i}" for i in range(len(chunks))]
        metadatas = [
            {
                "doc_id": doc_id,
                "source": f.filename or "unknown",
                "source_type": "file",
                "chunk_index": i,
                "upload_date": now,
            }
            for i in range(len(chunks))
        ]

        collection.add(ids=ids, documents=chunks, embeddings=embeddings, metadatas=metadatas)

        # Sync BM25 index
        app.state.bm25_service.add_chunks(chunks, metadatas, ids)

        results.append(
            DocumentInfo(
                doc_id=doc_id,
                source=f.filename or "unknown",
                source_type="file",
                chunk_count=len(chunks),
                upload_date=now,
            )
        )

    return results


@router.post("/url", response_model=DocumentInfo)
async def add_url(req: UrlRequest):
    from app.main import app

    try:
        text = await fetch_and_extract(req.url)
    except Exception as e:
        raise HTTPException(400, f"Failed to fetch URL: {e}")

    if not text.strip():
        raise HTTPException(400, "No content extracted from URL")

    doc_id = uuid.uuid4().hex[:12]
    chunks = chunk_text(text)
    if not chunks:
        raise HTTPException(400, "Content too short to chunk")

    embeddings = encode(chunks)
    collection = _get_collection(app)
    now = datetime.now(timezone.utc).isoformat()

    ids = [f"{doc_id}_chunk_{i}" for i in range(len(chunks))]
    metadatas = [
        {
            "doc_id": doc_id,
            "source": req.url,
            "source_type": "url",
            "chunk_index": i,
            "upload_date": now,
        }
        for i in range(len(chunks))
    ]

    collection.add(ids=ids, documents=chunks, embeddings=embeddings, metadatas=metadatas)

    # Sync BM25 index
    app.state.bm25_service.add_chunks(chunks, metadatas, ids)

    return DocumentInfo(
        doc_id=doc_id,
        source=req.url,
        source_type="url",
        chunk_count=len(chunks),
        upload_date=now,
    )


@router.get("", response_model=list[DocumentInfo])
async def list_documents():
    from app.main import app

    collection = _get_collection(app)
    if collection.count() == 0:
        return []

    all_meta = collection.get(include=["metadatas"])
    # Group by doc_id
    docs: dict[str, dict] = {}
    for meta in all_meta["metadatas"]:
        did = meta["doc_id"]
        if did not in docs:
            docs[did] = {
                "doc_id": did,
                "source": meta["source"],
                "source_type": meta["source_type"],
                "chunk_count": 0,
                "upload_date": meta["upload_date"],
            }
        docs[did]["chunk_count"] += 1

    return list(docs.values())


@router.delete("/{doc_id}")
async def delete_document(doc_id: str):
    from app.main import app

    collection = _get_collection(app)
    # Find all chunks for this doc_id
    results = collection.get(
        where={"doc_id": doc_id},
        include=[],
    )
    if not results["ids"]:
        raise HTTPException(404, f"Document {doc_id} not found")

    collection.delete(ids=results["ids"])

    # Sync BM25 index
    app.state.bm25_service.remove_chunks(results["ids"])

    return {"deleted": len(results["ids"])}
