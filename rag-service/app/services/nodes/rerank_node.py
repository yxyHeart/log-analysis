from app.services.reranker import rerank

RERANK_POOL = 20


def rerank_node(state: dict) -> dict:
    """Rerank candidates using cross-encoder."""
    candidates = state.get("candidates", [])
    query = state["query"]

    if not candidates:
        return {
            "reranked_candidates": [],
            "pipeline_steps": state.get("pipeline_steps", []) + ["rerank"],
        }

    reranked = rerank(query, candidates, RERANK_POOL)

    return {
        "reranked_candidates": reranked,
        "pipeline_steps": state.get("pipeline_steps", []) + ["rerank"],
    }
