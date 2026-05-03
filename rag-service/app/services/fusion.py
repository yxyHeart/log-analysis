def reciprocal_rank_fusion(
    results_list: list[list[dict]], k: int = 60
) -> list[dict]:
    """
    Reciprocal Rank Fusion: merge multiple ranked result sets.
    Formula: score = Σ(1 / (k + rank_i)) for each retriever.
    """
    doc_scores: dict[str, dict] = {}

    for results in results_list:
        for rank, doc in enumerate(results, start=1):
            doc_id = doc["id"]
            if doc_id not in doc_scores:
                doc_scores[doc_id] = {
                    "id": doc_id,
                    "chunk_text": doc["chunk_text"],
                    "metadata": doc["metadata"],
                    "retriever": doc.get("retriever", "unknown"),
                    "score": 0.0,
                }
            else:
                # Mark as found by both retrievers
                existing = doc_scores[doc_id]["retriever"]
                current = doc.get("retriever", "unknown")
                if existing != current:
                    doc_scores[doc_id]["retriever"] = "both"
            doc_scores[doc_id]["score"] += 1.0 / (k + rank)

    fused = sorted(doc_scores.values(), key=lambda x: x["score"], reverse=True)
    return fused
