import asyncio

from fastapi import APIRouter

from app.models.schemas import (
    SearchEvaluateRequest,
    SearchEvaluateResponse,
    QueryEvaluationResult,
    SearchRequest,
    SearchResponse,
    SearchResult,
)
from app.services.bm25 import BM25Service
from app.services.embedding import encode
from app.services.evaluation import calculate_metrics
from app.services.fusion import reciprocal_rank_fusion
from app.services.query_rewriter import rewrite_and_expand
from app.services.reranker import rerank

router = APIRouter(prefix="/search", tags=["search"])

CANDIDATE_POOL = 50
RERANK_POOL = 20


def _vector_search(query: str, top_k: int, collection) -> list[dict]:
    query_embedding = encode([query])[0]
    count = collection.count()
    if count == 0:
        return []
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=min(top_k, count),
        include=["documents", "metadatas", "distances"],
    )
    out = []
    for i, doc in enumerate(results["documents"][0]):
        meta = results["metadatas"][0][i]
        distance = results["distances"][0][i]
        out.append({
            "id": results["ids"][0][i],
            "chunk_text": doc,
            "metadata": meta,
            "score": round(1 - distance, 4),
            "retriever": "vector",
        })
    return out


def _bm25_search(bm25_service: BM25Service, query: str, top_k: int) -> list[dict]:
    return bm25_service.search(query, top_k=top_k)


def _search_single_query(query: str, req: SearchRequest, collection, bm25_service: BM25Service) -> list[dict]:
    """Run retrieval for a single query variant (BM25 + vector in hybrid, or vector only)."""
    if req.use_hybrid:
        bm25_results = _bm25_search(bm25_service, query, CANDIDATE_POOL)
        vector_results = _vector_search(query, CANDIDATE_POOL, collection)
        return reciprocal_rank_fusion([bm25_results, vector_results])
    return _vector_search(query, min(CANDIDATE_POOL, collection.count()), collection)


async def _run_pipeline(req: SearchRequest, collection, bm25_service: BM25Service) -> list[dict]:
    """Execute the full search pipeline based on request flags."""
    queries = [req.query]
    if req.use_query_rewriting and req.llm_config:
        queries = rewrite_and_expand(req.query, req.llm_config)

    # Retrieve candidates for each query variant in parallel
    loop = asyncio.get_event_loop()
    search_tasks = [
        loop.run_in_executor(None, _search_single_query, q, req, collection, bm25_service)
        for q in queries
    ]
    variant_results = await asyncio.gather(*search_tasks)

    all_candidates: dict[str, dict] = {}
    for fused in variant_results:
        for doc in fused:
            if doc["id"] not in all_candidates:
                all_candidates[doc["id"]] = doc

    candidates = sorted(all_candidates.values(), key=lambda x: x["score"], reverse=True)

    if req.use_reranker and candidates:
        candidates = await loop.run_in_executor(None, rerank, req.query, candidates, RERANK_POOL)

    return candidates[:req.top_k]


@router.post("", response_model=SearchResponse)
async def search(req: SearchRequest):
    from app.main import app

    collection = app.state.chroma_client.get_or_create_collection("logscope_kb")
    bm25_service: BM25Service = app.state.bm25_service

    if collection.count() == 0 and (not bm25_service.index or not bm25_service.chunks):
        return SearchResponse(results=[])

    results = _run_pipeline(req, collection, bm25_service)

    search_results = [
        SearchResult(
            chunk_text=r["chunk_text"],
            source=r["metadata"].get("source", ""),
            source_type=r["metadata"].get("source_type", ""),
            score=r["score"],
            retriever=r.get("retriever", "vector"),
        )
        for r in results
    ]

    return SearchResponse(results=search_results)


@router.post("/evaluate", response_model=SearchEvaluateResponse)
async def evaluate(req: SearchEvaluateRequest):
    from app.main import app

    collection = app.state.chroma_client.get_or_create_collection("logscope_kb")
    bm25_service: BM25Service = app.state.bm25_service

    per_query: list[QueryEvaluationResult] = []

    for eval_item in req.evaluations:
        search_req = SearchRequest(
            query=eval_item.query,
            top_k=req.k,
            use_hybrid=req.use_hybrid,
            use_reranker=req.use_reranker,
            use_query_rewriting=req.use_query_rewriting,
            llm_config=req.llm_config,
        )
        results = _run_pipeline(search_req, collection, bm25_service)
        retrieved_ids = [r["id"] for r in results]

        # Extract doc_ids from chunk ids (format: {doc_id}_chunk_{i})
        retrieved_doc_ids = list({
            rid.split("_chunk_")[0] for rid in retrieved_ids if "_chunk_" in rid
        })

        metrics = calculate_metrics(
            retrieved_doc_ids, eval_item.relevant_document_ids, req.k
        )
        per_query.append(
            QueryEvaluationResult(query=eval_item.query, metrics=metrics)
        )

    # Compute overall averages
    if per_query:
        overall = {
            key: round(
                sum(q.metrics.get(key, 0) for q in per_query) / len(per_query), 4
            )
            for key in ["recall", "mrr", "ndcg"]
        }
    else:
        overall = {"recall": 0.0, "mrr": 0.0, "ndcg": 0.0}

    return SearchEvaluateResponse(overall=overall, per_query=per_query)
