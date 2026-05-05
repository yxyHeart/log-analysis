import logging

logger = logging.getLogger(__name__)

QUALITY_THRESHOLD = 0.4
SCORE_GAP_THRESHOLD = 0.05


def _compute_quality_score(candidates: list[dict]) -> tuple[float, str]:
    """Compute quality score based on retrieval results.

    Returns (score, reason).
    """
    if not candidates:
        return 0.0, "no_candidates"

    top_score = candidates[0].get("score", 0.0)

    # Score component: how high is the top result
    # Normalize: assume cross-encoder scores > 0.5 are good, vector scores > 0.7
    retriever = candidates[0].get("retriever", "vector")
    if retriever == "reranker":
        score_norm = min(top_score / 1.0, 1.0)  # cross-encoder can score > 1
    else:
        score_norm = min(top_score / 0.8, 1.0)  # vector/cosine scores

    # Coverage component: how many results have non-trivial scores
    if len(candidates) >= 2:
        second_score = candidates[1].get("score", 0.0)
        score_gap = top_score - second_score
        # Small gap = consistent results (good); large gap = only one good result (moderate)
        gap_factor = 1.0 if score_gap < SCORE_GAP_THRESHOLD else 0.7
    else:
        gap_factor = 0.5

    # Count component: penalize if very few candidates
    count_factor = min(len(candidates) / 10.0, 1.0)

    quality = 0.5 * score_norm + 0.3 * gap_factor + 0.2 * count_factor
    quality = round(quality, 3)

    reason = "passed" if quality >= QUALITY_THRESHOLD else "low_quality"
    return quality, reason


def quality_gate_node(state: dict) -> dict:
    """Quality gate: evaluate retrieval quality and decide whether to loop back."""
    candidates = state.get("reranked_candidates") or state.get("candidates", [])
    rewrite_attempts = state.get("rewrite_attempts", 0)

    quality_score, reason = _compute_quality_score(candidates)
    quality_passed = quality_score >= QUALITY_THRESHOLD

    # Dynamic K adjustment: if scores are tightly clustered, relax top_k
    dynamic_k = state.get("top_k", 5)
    if len(candidates) >= 2:
        scores = [c.get("score", 0.0) for c in candidates[:min(10, len(candidates))]]
        if len(scores) >= 2:
            # Check if scores near the top_k boundary are close
            if len(scores) > dynamic_k and dynamic_k < len(scores):
                boundary_gap = abs(scores[dynamic_k - 1] - scores[dynamic_k])
                if boundary_gap < SCORE_GAP_THRESHOLD:
                    dynamic_k = min(dynamic_k + max(dynamic_k // 2, 1), len(candidates))

    # If max attempts reached, accept best effort
    if not quality_passed and rewrite_attempts >= state.get("max_rewrite_attempts", 2):
        quality_passed = True
        reason = "accepted_best_effort"

    return {
        "quality_score": quality_score,
        "quality_passed": quality_passed,
        "quality_reason": reason,
        "dynamic_k": dynamic_k,
        "rewrite_attempts": rewrite_attempts + (0 if quality_passed else 1),
        "pipeline_steps": state.get("pipeline_steps", []) + ["quality_gate"],
    }


def quality_gate_router(state: dict) -> str:
    """Route based on quality gate outcome."""
    if state.get("quality_passed", False):
        return "passed"
    if state.get("rewrite_attempts", 0) < state.get("max_rewrite_attempts", 2):
        return "rewrite"
    return "accept"
