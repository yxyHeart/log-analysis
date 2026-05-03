import math


def recall_at_k(
    retrieved_ids: list[str], relevant_ids: set[str], k: int = 10
) -> float:
    """Recall@K: fraction of relevant documents retrieved in top-K."""
    if not relevant_ids:
        return 0.0
    top_k_set = set(retrieved_ids[:k])
    return len(top_k_set & relevant_ids) / len(relevant_ids)


def mrr(retrieved_ids: list[str], relevant_ids: set[str]) -> float:
    """Mean Reciprocal Rank: reciprocal of the rank of the first relevant document."""
    for rank, doc_id in enumerate(retrieved_ids, start=1):
        if doc_id in relevant_ids:
            return 1.0 / rank
    return 0.0


def _dcg(relevance: list[float], k: int) -> float:
    return sum(
        rel / math.log2(i + 2) for i, rel in enumerate(relevance[:k])
    )


def ndcg_at_k(
    retrieved_ids: list[str], relevant_ids: set[str], k: int = 10
) -> float:
    """Normalized Discounted Cumulative Gain at K."""
    relevance = [
        1.0 if doc_id in relevant_ids else 0.0 for doc_id in retrieved_ids[:k]
    ]
    if not relevance:
        return 0.0

    actual_dcg = _dcg(relevance, k)
    ideal_relevance = sorted(relevance, reverse=True)
    ideal_dcg = _dcg(ideal_relevance, k)

    if ideal_dcg == 0:
        return 0.0
    return actual_dcg / ideal_dcg


def calculate_metrics(
    retrieved_ids: list[str], relevant_ids: list[str], k: int = 10
) -> dict:
    """Calculate all evaluation metrics."""
    rel_set = set(relevant_ids)
    return {
        "recall": round(recall_at_k(retrieved_ids, rel_set, k), 4),
        "mrr": round(mrr(retrieved_ids, rel_set), 4),
        "ndcg": round(ndcg_at_k(retrieved_ids, rel_set, k), 4),
    }
