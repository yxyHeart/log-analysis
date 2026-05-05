import asyncio

from app.services.embedding import encode
from app.services.es_client import hybrid_search


def _build_es_filters(extracted_filters: dict) -> list[dict]:
    """Convert extracted filters to ES query filter clauses."""
    clauses = []
    if not extracted_filters:
        return clauses

    if "affected_services" in extracted_filters:
        services = extracted_filters["affected_services"]
        if isinstance(services, list) and services:
            clauses.append({"terms": {"affected_services": services}})
        elif isinstance(services, str):
            clauses.append({"term": {"affected_services": services}})

    if "root_cause_category" in extracted_filters:
        clauses.append({"term": {"root_cause_category": extracted_filters["root_cause_category"]}})

    if "error_type" in extracted_filters:
        clauses.append({"term": {"error_type": extracted_filters["error_type"]}})

    if "severity" in extracted_filters:
        clauses.append({"term": {"severity": extracted_filters["severity"]}})

    return clauses


async def hybrid_retrieval_node(state: dict) -> dict:
    """Hybrid retrieval: ES native kNN + BM25 + RRF for each query variant."""
    queries = state.get("rewritten_queries", [state["query"]])
    top_k = state.get("top_k", 50)
    use_hybrid = True  # Always use hybrid in the state machine pipeline
    extracted_filters = state.get("extracted_filters", {})
    es_client = state.get("es_client")

    if not es_client:
        from app.main import app
        es_client = app.state.es_client

    filter_clauses = _build_es_filters(extracted_filters)

    # Run search for each query variant in parallel
    async def _search(q: str) -> list[dict]:
        query_embedding = encode([q])[0]
        return await hybrid_search(
            client=es_client,
            query_embedding=query_embedding,
            query_text=q,
            top_k=top_k,
            use_hybrid=use_hybrid,
            filters=filter_clauses if filter_clauses else None,
        )

    results = await asyncio.gather(*[_search(q) for q in queries])

    # Deduplicate across variants, keep highest score
    all_candidates: dict[str, dict] = {}
    for variant in results:
        for doc in variant:
            if doc["id"] not in all_candidates or doc["score"] > all_candidates[doc["id"]]["score"]:
                all_candidates[doc["id"]] = doc

    candidates = sorted(all_candidates.values(), key=lambda x: x["score"], reverse=True)

    return {
        "candidates": candidates,
        "pipeline_steps": state.get("pipeline_steps", []) + ["hybrid_retrieval"],
    }
