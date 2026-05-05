import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, UploadFile, File, HTTPException
from typing import Annotated

from app.models.schemas import DocumentInfo, UrlRequest, IncidentReportUpload
from app.services.chunking import chunk_text_with_metadata
from app.services.embedding import encode
from app.services.crawler import fetch_and_extract
from app.services.es_client import index_chunks, delete_by_doc_id, list_documents
from app.services.metadata_extractor import (
    extract_error_type,
    extract_affected_services,
    extract_call_chain,
)

router = APIRouter(prefix="/documents", tags=["documents"])


def _enrich_metadata(base_meta: dict, chunk_text: str, extra: dict | None = None) -> dict:
    """Add extracted metadata to chunk metadata."""
    meta = {**base_meta}
    if extra:
        for k, v in extra.items():
            if v is not None and k not in meta:
                meta[k] = v
    # Extract from chunk content if not already set
    if not meta.get("error_type"):
        meta["error_type"] = extract_error_type(chunk_text)
    if not meta.get("affected_services"):
        services = extract_affected_services(chunk_text)
        if services:
            meta["affected_services"] = services
    if not meta.get("call_chain"):
        meta["call_chain"] = extract_call_chain(chunk_text)
    return meta


@router.post("/upload", response_model=list[DocumentInfo])
async def upload_files(
    files: Annotated[list[UploadFile], File(description="Markdown or text files")],
):
    from app.main import app

    es = app.state.es_client
    results = []

    for f in files:
        content = await f.read()
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError:
            raise HTTPException(400, f"File {f.filename} is not valid UTF-8 text")

        doc_id = uuid.uuid4().hex[:12]
        source = f.filename or "unknown"
        chunk_tuples = chunk_text_with_metadata(text, source=source, source_type="file", doc_id=doc_id)
        if not chunk_tuples:
            continue

        chunks = [ct for ct, _ in chunk_tuples]
        base_metas = [cm for _, cm in chunk_tuples]
        embeddings = encode(chunks)
        now = datetime.now(timezone.utc).isoformat()

        ids = [f"{doc_id}_chunk_{i}" for i in range(len(chunks))]
        metadatas = []
        for i, (chunk, base_meta) in enumerate(chunk_tuples):
            meta = _enrich_metadata(base_meta, chunk)
            meta["upload_date"] = now
            metadatas.append(meta)

        await index_chunks(es, ids, chunks, embeddings, metadatas)

        # Determine category for document info
        categories = set(m.get("root_cause_category") for m in metadatas if m.get("root_cause_category"))
        all_services = set()
        for m in metadatas:
            if m.get("affected_services"):
                all_services.update(m["affected_services"])

        results.append(
            DocumentInfo(
                doc_id=doc_id,
                source=source,
                source_type="file",
                chunk_count=len(chunks),
                upload_date=now,
                root_cause_category=categories.pop() if len(categories) == 1 else None,
                affected_services=sorted(all_services) if all_services else None,
            )
        )

    return results


@router.post("/url", response_model=DocumentInfo)
async def add_url(req: UrlRequest):
    from app.main import app

    es = app.state.es_client

    try:
        text = await fetch_and_extract(req.url)
    except Exception as e:
        raise HTTPException(400, f"Failed to fetch URL: {e}")

    if not text.strip():
        raise HTTPException(400, "No content extracted from URL")

    doc_id = uuid.uuid4().hex[:12]
    chunk_tuples = chunk_text_with_metadata(text, source=req.url, source_type="url", doc_id=doc_id)
    if not chunk_tuples:
        raise HTTPException(400, "Content too short to chunk")

    chunks = [ct for ct, _ in chunk_tuples]
    base_metas = [cm for _, cm in chunk_tuples]
    embeddings = encode(chunks)
    now = datetime.now(timezone.utc).isoformat()

    ids = [f"{doc_id}_chunk_{i}" for i in range(len(chunks))]
    metadatas = []
    for i, (chunk, base_meta) in enumerate(chunk_tuples):
        meta = _enrich_metadata(base_meta, chunk)
        meta["upload_date"] = now
        metadatas.append(meta)

    await index_chunks(es, ids, chunks, embeddings, metadatas)

    categories = set(m.get("root_cause_category") for m in metadatas if m.get("root_cause_category"))
    all_services = set()
    for m in metadatas:
        if m.get("affected_services"):
            all_services.update(m["affected_services"])

    return DocumentInfo(
        doc_id=doc_id,
        source=req.url,
        source_type="url",
        chunk_count=len(chunks),
        upload_date=now,
        root_cause_category=categories.pop() if len(categories) == 1 else None,
        affected_services=sorted(all_services) if all_services else None,
    )


@router.post("/incident", response_model=DocumentInfo)
async def upload_incident_report(req: IncidentReportUpload):
    """Upload a structured incident report with metadata."""
    from app.main import app

    es = app.state.es_client
    doc_id = uuid.uuid4().hex[:12]

    chunk_tuples = chunk_text_with_metadata(
        req.content, source=req.title, source_type="incident_report", doc_id=doc_id
    )
    if not chunk_tuples:
        raise HTTPException(400, "Content too short to chunk")

    chunks = [ct for ct, _ in chunk_tuples]
    base_metas = [cm for _, cm in chunk_tuples]
    embeddings = encode(chunks)
    now = datetime.now(timezone.utc).isoformat()

    ids = [f"{doc_id}_chunk_{i}" for i in range(len(chunks))]
    metadatas = []
    for i, (chunk, base_meta) in enumerate(chunk_tuples):
        meta = _enrich_metadata(base_meta, chunk, {
            "root_cause_category": req.root_cause_category,
            "affected_services": req.affected_services,
            "severity": req.severity,
            "call_chain": req.call_chain,
            "resolution_status": req.resolution_status,
        })
        meta["upload_date"] = now
        metadatas.append(meta)

    await index_chunks(es, ids, chunks, embeddings, metadatas)

    return DocumentInfo(
        doc_id=doc_id,
        source=req.title,
        source_type="incident_report",
        chunk_count=len(chunks),
        upload_date=now,
        root_cause_category=req.root_cause_category,
        affected_services=req.affected_services,
        severity=req.severity,
    )


@router.get("", response_model=list[DocumentInfo])
async def get_documents():
    from app.main import app

    es = app.state.es_client
    return await list_documents(es)


@router.delete("/{doc_id}")
async def delete_document(doc_id: str):
    from app.main import app

    es = app.state.es_client
    deleted = await delete_by_doc_id(es, doc_id)

    if deleted == 0:
        raise HTTPException(404, f"Document {doc_id} not found")

    return {"deleted": deleted}
