def response_generation_node(state: dict) -> dict:
    """Select top-K results with dynamic K adjustment."""
    candidates = state.get("reranked_candidates") or state.get("candidates", [])
    top_k = state.get("dynamic_k", state.get("top_k", 5))

    final = candidates[:top_k]

    return {
        "final_results": final,
        "pipeline_steps": state.get("pipeline_steps", []) + ["response_generation"],
    }
