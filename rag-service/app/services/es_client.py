import os
import logging
from typing import Any

from elasticsearch import AsyncElasticsearch

from app.services.elasticsearch import INDEX_MAPPING, INDEX_NAME

logger = logging.getLogger(__name__)

_client: AsyncElasticsearch | None = None


def get_client() -> AsyncElasticsearch:
    global _client
    if _client is None:
        host = os.getenv("ES_HOST", "localhost")
        port = int(os.getenv("ES_PORT", "9200"))
        _client = AsyncElasticsearch(f"http://{host}:{port}")
    return _client


async def ensure_index(client: AsyncElasticsearch | None = None) -> None:
    if client is None:
        client = get_client()
    exists = await client.indices.exists(index=INDEX_NAME)
    if not exists:
        await client.indices.create(index=INDEX_NAME, body=INDEX_MAPPING)
        logger.info("Created ES index: %s", INDEX_NAME)
    else:
        logger.info("ES index already exists: %s", INDEX_NAME)


async def index_chunks(
    client: AsyncElasticsearch,
    ids: list[str],
    texts: list[str],
    embeddings: list[list[float]],
    metadatas: list[dict],
) -> None:
    actions = []
    for chunk_id, text, emb, meta in zip(ids, texts, embeddings, metadatas):
        doc = {
            "chunk_text": text,
            "embedding": emb,
            **meta,
        }
        actions.append({"index": {"_index": INDEX_NAME, "_id": chunk_id}})
        actions.append(doc)
    if actions:
        await client.bulk(body=actions, refresh=True)


async def delete_by_doc_id(client: AsyncElasticsearch, doc_id: str) -> int:
    result = await client.delete_by_query(
        index=INDEX_NAME,
        body={"query": {"term": {"doc_id": doc_id}}},
        refresh=True,
    )
    return result.get("deleted", 0)


async def list_documents(client: AsyncElasticsearch) -> list[dict]:
    result = await client.search(
        index=INDEX_NAME,
        body={
            "size": 0,
            "aggs": {
                "by_doc": {
                    "terms": {"field": "doc_id", "size": 10000},
                    "aggs": {
                        "source": {"terms": {"field": "source", "size": 1}},
                        "source_type": {"terms": {"field": "source_type", "size": 1}},
                        "upload_date": {"terms": {"field": "upload_date", "size": 1}},
                    },
                }
            },
        },
    )
    buckets = result.get("aggregations", {}).get("by_doc", {}).get("buckets", [])
    docs = []
    for b in buckets:
        source_b = b["source"]["buckets"]
        st_b = b["source_type"]["buckets"]
        date_b = b["upload_date"]["buckets"]
        docs.append({
            "doc_id": b["key"],
            "chunk_count": b["doc_count"],
            "source": source_b[0]["key"] if source_b else "",
            "source_type": st_b[0]["key"] if st_b else "",
            "upload_date": date_b[0]["key"] if date_b else "",
        })
    return docs


async def count(client: AsyncElasticsearch) -> int:
    result = await client.count(index=INDEX_NAME)
    return result.get("count", 0)


async def hybrid_search(
    client: AsyncElasticsearch,
    query_embedding: list[float],
    query_text: str,
    top_k: int = 50,
    use_hybrid: bool = True,
    filters: list[dict] | None = None,
) -> list[dict]:
    """Native ES hybrid search: kNN + BM25 + RRF, or kNN only."""
    filter_clauses = filters or []

    if use_hybrid:
        body: dict[str, Any] = {
            "size": top_k,
            "knn": {
                "field": "embedding",
                "query_vector": query_embedding,
                "k": top_k,
                "num_candidates": top_k * 4,
            },
            "query": {
                "bool": {
                    "must": [{"match": {"chunk_text": {"query": query_text}}}],
                    **({"filter": filter_clauses} if filter_clauses else {}),
                }
            },
            "rank": {"rrf": {"window_size": top_k, "rank_constant": 60}},
        }
    else:
        knn_clause: dict[str, Any] = {
            "field": "embedding",
            "query_vector": query_embedding,
            "k": top_k,
            "num_candidates": top_k * 4,
        }
        if filter_clauses:
            knn_clause["filter"] = filter_clauses
        body = {"size": top_k, "knn": knn_clause}

    result = await client.search(index=INDEX_NAME, body=body)
    hits = result.get("hits", {}).get("hits", [])
    out = []
    for hit in hits:
        source = hit["_source"]
        out.append({
            "id": hit["_id"],
            "chunk_text": source.get("chunk_text", ""),
            "metadata": {
                k: v
                for k, v in source.items()
                if k not in ("chunk_text", "embedding")
            },
            "score": hit.get("_score", 0.0),
            "retriever": "both" if use_hybrid else "vector",
        })
    return out
