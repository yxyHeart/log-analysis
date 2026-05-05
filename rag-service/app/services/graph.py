from typing import TypedDict

from langgraph.graph import StateGraph, END

from app.services.nodes.query_analysis import query_analysis_node
from app.services.nodes.hybrid_retrieval import hybrid_retrieval_node
from app.services.nodes.rerank_node import rerank_node
from app.services.nodes.quality_gate import quality_gate_node, quality_gate_router
from app.services.nodes.response_generation import response_generation_node


class AgentState(TypedDict, total=False):
    # Input
    query: str
    top_k: int
    llm_config: dict | None
    metadata_filters: dict | None
    es_client: object

    # Query Analysis
    rewritten_queries: list[str]
    query_intent: str
    extracted_filters: dict
    rewrite_attempts: int
    max_rewrite_attempts: int

    # Retrieval
    candidates: list[dict]
    retrieval_scores: list[float]

    # Reranking
    reranked_candidates: list[dict]

    # Quality Gate
    quality_score: float
    quality_passed: bool
    quality_reason: str
    dynamic_k: int

    # Response
    final_results: list[dict]

    # Metadata
    pipeline_steps: list[str]
    total_latency_ms: float


def build_rag_graph():
    graph = StateGraph(AgentState)

    graph.add_node("query_analysis", query_analysis_node)
    graph.add_node("hybrid_retrieval", hybrid_retrieval_node)
    graph.add_node("rerank", rerank_node)
    graph.add_node("quality_gate", quality_gate_node)
    graph.add_node("response_generation", response_generation_node)

    graph.set_entry_point("query_analysis")
    graph.add_edge("query_analysis", "hybrid_retrieval")
    graph.add_edge("hybrid_retrieval", "rerank")
    graph.add_edge("rerank", "quality_gate")
    graph.add_conditional_edges(
        "quality_gate",
        quality_gate_router,
        {
            "passed": "response_generation",
            "rewrite": "query_analysis",
            "accept": "response_generation",
        },
    )
    graph.add_edge("response_generation", END)

    return graph.compile()


# Compiled graph singleton
_compiled_graph = None


def get_graph():
    global _compiled_graph
    if _compiled_graph is None:
        _compiled_graph = build_rag_graph()
    return _compiled_graph
