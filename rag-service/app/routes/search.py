import asyncio
import time

from fastapi import APIRouter

from app.models.schemas import (
    AssertionEvaluateRequest,
    AssertionEvaluateResponse,
    AssertionVerdict,
    QueryAssertionResult,
    SearchEvaluateRequest,
    SearchEvaluateResponse,
    QueryEvaluationResult,
    SearchRequest,
    SearchResponse,
    SearchResult,
)
from app.services.embedding import encode
from app.services.es_client import hybrid_search, count as es_count
from app.services.evaluation import calculate_metrics
from app.services.graph import get_graph, AgentState
from app.services.query_rewriter import rewrite_and_expand
from app.services.reranker import rerank
from app.services.rag_checker import (
    extract_assertions_from_context,
    extract_assertions_from_ground_truth,
    verify_assertion,
    compute_rag_checker_metrics,
)

router = APIRouter(prefix="/search", tags=["search"])

CANDIDATE_POOL = 50
RERANK_POOL = 20


async def _run_pipeline_legacy(req: SearchRequest, es_client) -> list[dict]:
    """Legacy linear pipeline (no LangGraph, no quality gate)."""
    queries = [req.query]
    if req.use_query_rewriting and req.llm_config:
        queries = await asyncio.get_event_loop().run_in_executor(
            None, rewrite_and_expand, req.query, req.llm_config
        )

    search_tasks = [
        _search_single_query(q, req, es_client) for q in queries
    ]
    variant_results = await asyncio.gather(*search_tasks)

    all_candidates: dict[str, dict] = {}
    for variant in variant_results:
        for doc in variant:
            if doc["id"] not in all_candidates or doc["score"] > all_candidates[doc["id"]]["score"]:
                all_candidates[doc["id"]] = doc

    candidates = sorted(all_candidates.values(), key=lambda x: x["score"], reverse=True)

    if req.use_reranker and candidates:
        loop = asyncio.get_event_loop()
        candidates = await loop.run_in_executor(
            None, rerank, req.query, candidates, RERANK_POOL
        )

    return candidates[:req.top_k]


async def _search_single_query(
    query: str, req: SearchRequest, es_client
) -> list[dict]:
    query_embedding = encode([query])[0]
    return await hybrid_search(
        client=es_client,
        query_embedding=query_embedding,
        query_text=query,
        top_k=CANDIDATE_POOL,
        use_hybrid=req.use_hybrid,
    )


async def _run_pipeline_graph(req: SearchRequest, es_client) -> list[dict]:
    """LangGraph state machine pipeline with quality gate."""
    graph = get_graph()

    # Convert LLMConfig to dict for LangGraph state
    llm_config_dict = None
    if req.llm_config:
        llm_config_dict = req.llm_config.model_dump()

    initial_state: AgentState = {
        "query": req.query,
        "top_k": req.top_k,
        "llm_config": llm_config_dict,
        "metadata_filters": req.metadata_filters,
        "es_client": es_client,
        "rewritten_queries": [],
        "query_intent": "",
        "extracted_filters": {},
        "rewrite_attempts": 0,
        "max_rewrite_attempts": 2,
        "candidates": [],
        "retrieval_scores": [],
        "reranked_candidates": [],
        "quality_score": 0.0,
        "quality_passed": False,
        "quality_reason": "",
        "dynamic_k": req.top_k,
        "final_results": [],
        "pipeline_steps": [],
        "total_latency_ms": 0.0,
    }

    start = time.time()
    result = await graph.ainvoke(initial_state)
    elapsed = (time.time() - start) * 1000

    # Update latency
    result["total_latency_ms"] = round(elapsed, 1)

    return result.get("final_results", [])


@router.post("", response_model=SearchResponse)
async def search(req: SearchRequest):
    from app.main import app

    es = app.state.es_client
    total = await es_count(es)

    if total == 0:
        return SearchResponse(results=[])

    # Use LangGraph pipeline when hybrid+reranker or when query rewriting is enabled
    use_graph = req.use_hybrid or req.use_reranker or req.use_query_rewriting

    if use_graph:
        results = await _run_pipeline_graph(req, es)
    else:
        results = await _run_pipeline_legacy(req, es)

    search_results = [
        SearchResult(
            chunk_text=r["chunk_text"],
            source=r["metadata"].get("source", ""),
            source_type=r["metadata"].get("source_type", ""),
            score=r["score"],
            retriever=r.get("retriever", "vector"),
            root_cause_category=r["metadata"].get("root_cause_category"),
            affected_services=r["metadata"].get("affected_services"),
            error_type=r["metadata"].get("error_type"),
            severity=r["metadata"].get("severity"),
            call_chain=r["metadata"].get("call_chain"),
            stack_trace_present=r["metadata"].get("stack_trace_present"),
            resolution_status=r["metadata"].get("resolution_status"),
            semantic_summary=r["metadata"].get("semantic_summary"),
        )
        for r in results
    ]

    return SearchResponse(results=search_results)


@router.post("/evaluate", response_model=SearchEvaluateResponse)
async def evaluate(req: SearchEvaluateRequest):
    from app.main import app

    es = app.state.es_client
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
        results = await _run_pipeline_legacy(search_req, es)
        retrieved_ids = [r["id"] for r in results]

        retrieved_doc_ids = list({
            rid.split("_chunk_")[0] for rid in retrieved_ids if "_chunk_" in rid
        })

        metrics = calculate_metrics(
            retrieved_doc_ids, eval_item.relevant_document_ids, req.k
        )
        per_query.append(
            QueryEvaluationResult(query=eval_item.query, metrics=metrics)
        )

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


@router.post("/evaluate/assertion", response_model=AssertionEvaluateResponse)
async def evaluate_assertions(req: AssertionEvaluateRequest):
    """RAGChecker-style assertion-level evaluation."""
    from app.main import app

    if not req.llm_config or not req.llm_config.api_key:
        from fastapi import HTTPException
        raise HTTPException(400, "LLM config with API key is required for assertion evaluation")

    es = app.state.es_client
    per_query: list[QueryAssertionResult] = []

    for eval_item in req.evaluations:
        # Run search to get retrieved context
        search_req = SearchRequest(
            query=eval_item.query,
            top_k=req.k,
            use_hybrid=req.use_hybrid,
            use_reranker=req.use_reranker,
            use_query_rewriting=req.use_query_rewriting,
            llm_config=req.llm_config,
        )
        results = await _run_pipeline_legacy(search_req, es)

        # Build context from retrieved chunks
        context_text = "\n\n".join(r["chunk_text"] for r in results[:5])

        # Extract assertions from context
        loop = asyncio.get_event_loop()
        ctx_assertions = await loop.run_in_executor(
            None, extract_assertions_from_context, context_text, eval_item.query, req.llm_config
        )

        # Extract assertions from ground truth
        gt_assertions = await loop.run_in_executor(
            None, extract_assertions_from_ground_truth, eval_item.ground_truth_answer, req.llm_config
        )

        # Verify each context assertion against ground truth
        verification_results = []
        for assertion in ctx_assertions:
            claim = assertion.get("claim", "")
            if not claim:
                continue
            verdict = await loop.run_in_executor(
                None, verify_assertion, claim, eval_item.ground_truth_answer, req.llm_config
            )
            verification_results.append(verdict)

        # Compute metrics
        metrics = compute_rag_checker_metrics(ctx_assertions, gt_assertions, verification_results)

        # Also compute traditional document-level metrics
        retrieved_ids = [r["id"] for r in results]
        retrieved_doc_ids = list({
            rid.split("_chunk_")[0] for rid in retrieved_ids if "_chunk_" in rid
        })
        traditional = calculate_metrics(
            retrieved_doc_ids, eval_item.relevant_document_ids, req.k
        )
        metrics["document_recall"] = traditional.get("recall", 0.0)
        metrics["document_mrr"] = traditional.get("mrr", 0.0)
        metrics["document_ndcg"] = traditional.get("ndcg", 0.0)

        per_query.append(
            QueryAssertionResult(
                query=eval_item.query,
                context_assertions=ctx_assertions,
                ground_truth_assertions=gt_assertions,
                verification_results=[
                    AssertionVerdict(
                        assertion=v.get("assertion", v.get("claim", "")),
                        verdict=v.get("verdict", "unverifiable"),
                        reason=v.get("reason", ""),
                    )
                    for v in verification_results
                ],
                metrics=metrics,
            )
        )

    # Compute overall averages
    if per_query:
        metric_keys = [
            "claim_recall", "claim_precision", "claim_f1", "faithfulness",
            "document_recall", "document_mrr", "document_ndcg",
        ]
        overall = {
            key: round(
                sum(q.metrics.get(key, 0) for q in per_query) / len(per_query), 4
            )
            for key in metric_keys
        }
        overall["total_assertions"] = sum(q.metrics.get("total_assertions", 0) for q in per_query)
        overall["supported_count"] = sum(q.metrics.get("supported_count", 0) for q in per_query)
        overall["contradicted_count"] = sum(q.metrics.get("contradicted_count", 0) for q in per_query)
        overall["unverifiable_count"] = sum(q.metrics.get("unverifiable_count", 0) for q in per_query)
    else:
        overall = {
            "claim_recall": 0.0,
            "claim_precision": 0.0,
            "claim_f1": 0.0,
            "faithfulness": 0.0,
            "document_recall": 0.0,
            "document_mrr": 0.0,
            "document_ndcg": 0.0,
            "total_assertions": 0,
            "supported_count": 0,
            "contradicted_count": 0,
            "unverifiable_count": 0,
        }

    return AssertionEvaluateResponse(overall=overall, per_query=per_query)
