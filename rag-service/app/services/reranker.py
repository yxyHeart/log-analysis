from sentence_transformers import CrossEncoder

RERANKER_MODEL = "cross-encoder/ms-marco-MiniLM-L-12-v2"
_reranker: CrossEncoder | None = None


def get_reranker() -> CrossEncoder:
    global _reranker
    if _reranker is None:
        _reranker = CrossEncoder(RERANKER_MODEL, max_length=512)
    return _reranker


def rerank(
    query: str, candidates: list[dict], top_k: int = 20
) -> list[dict]:
    """Rerank candidates using cross-encoder. Takes top-K candidates, returns reranked."""
    if not candidates:
        return []

    model = get_reranker()
    rerank_input = candidates[:top_k]

    pairs = [(query, c["chunk_text"]) for c in rerank_input]
    scores = model.predict(pairs)

    for i, score in enumerate(scores):
        rerank_input[i]["score"] = float(score)
        rerank_input[i]["retriever"] = "reranker"

    reranked = sorted(rerank_input, key=lambda x: x["score"], reverse=True)
    return reranked
