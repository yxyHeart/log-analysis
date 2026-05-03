from typing import Literal

from pydantic import BaseModel

RetrieverSource = Literal["vector", "bm25", "reranker", "both"]


class DocumentInfo(BaseModel):
    doc_id: str
    source: str
    source_type: Literal["file", "url"]
    chunk_count: int
    upload_date: str


class SearchResult(BaseModel):
    chunk_text: str
    source: str
    source_type: str
    score: float
    retriever: RetrieverSource = "vector"


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
