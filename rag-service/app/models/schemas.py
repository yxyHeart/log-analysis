from typing import Literal

from pydantic import BaseModel

RetrieverSource = Literal["vector", "bm25", "reranker", "both"]


class DocumentInfo(BaseModel):
    doc_id: str
    source: str
    source_type: Literal["file", "url", "incident_report"]
    chunk_count: int
    upload_date: str
    root_cause_category: str | None = None
    affected_services: list[str] | None = None
    severity: str | None = None


class SearchResult(BaseModel):
    chunk_text: str
    source: str
    source_type: str
    score: float
    retriever: RetrieverSource = "vector"
    root_cause_category: str | None = None
    affected_services: list[str] | None = None
    error_type: str | None = None
    severity: str | None = None
    call_chain: str | None = None
    stack_trace_present: bool | None = None
    resolution_status: str | None = None
    semantic_summary: str | None = None


class LLMConfig(BaseModel):
    provider: Literal["openai", "anthropic"]
    api_key: str
    model: str | None = None
    base_url: str | None = None


class SearchRequest(BaseModel):
    query: str
    top_k: int = 5
    use_hybrid: bool = False
    use_reranker: bool = False
    use_query_rewriting: bool = False
    llm_config: LLMConfig | None = None
    metadata_filters: dict | None = None


class SearchResponse(BaseModel):
    results: list[SearchResult]


class QueryEvaluation(BaseModel):
    query: str
    relevant_document_ids: list[str]


class QueryEvaluationResult(BaseModel):
    query: str
    metrics: dict


class SearchEvaluateRequest(BaseModel):
    evaluations: list[QueryEvaluation]
    k: int = 10
    use_hybrid: bool = False
    use_reranker: bool = False
    use_query_rewriting: bool = False
    llm_config: LLMConfig | None = None


class SearchEvaluateResponse(BaseModel):
    overall: dict
    per_query: list[QueryEvaluationResult]


class UrlRequest(BaseModel):
    url: str


class IncidentReportUpload(BaseModel):
    """Structured upload for root cause analysis incident reports."""
    title: str
    content: str
    source_type: Literal["incident_report"] = "incident_report"
    root_cause_category: str | None = None
    affected_services: list[str] | None = None
    severity: str | None = None
    call_chain: str | None = None
    resolution_status: Literal["resolved", "workaround", "unresolved"] | None = None


# RAGChecker assertion-level evaluation


class AssertionQuery(BaseModel):
    query: str
    relevant_document_ids: list[str]
    ground_truth_answer: str


class AssertionVerdict(BaseModel):
    assertion: str
    verdict: Literal["supported", "contradicted", "unverifiable"]
    reason: str


class QueryAssertionResult(BaseModel):
    query: str
    context_assertions: list[dict]
    ground_truth_assertions: list[dict]
    verification_results: list[AssertionVerdict]
    metrics: dict


class AssertionEvaluateRequest(BaseModel):
    evaluations: list[AssertionQuery]
    k: int = 10
    use_hybrid: bool = True
    use_reranker: bool = True
    use_query_rewriting: bool = True
    llm_config: LLMConfig | None = None


class AssertionEvaluateResponse(BaseModel):
    overall: dict
    per_query: list[QueryAssertionResult]
