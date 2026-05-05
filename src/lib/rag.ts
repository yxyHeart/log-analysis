import type { KBDocument, RAGResult, RootCauseMetadata, RAGCheckerMetrics } from "./types";

const DEFAULT_RAG_URL = "http://localhost:8000";

function baseUrl(ragServiceUrl?: string): string {
  return (ragServiceUrl || DEFAULT_RAG_URL).replace(/\/+$/, "");
}

function toKBDocument(d: Record<string, unknown>): KBDocument {
  return {
    docId: (d.doc_id ?? d.docId) as string,
    source: d.source as string,
    sourceType: (d.source_type ?? d.sourceType) as "file" | "url" | "incident_report",
    chunkCount: (d.chunk_count ?? d.chunkCount) as number,
    uploadDate: (d.upload_date ?? d.uploadDate) as string,
    rootCauseCategory: (d.root_cause_category ?? d.rootCauseCategory) as string | undefined,
    affectedServices: (d.affected_services ?? d.affectedServices) as string[] | undefined,
    severity: (d.severity) as string | undefined,
  };
}

function toRootCauseMetadata(d: Record<string, unknown>): RootCauseMetadata | undefined {
  const hasAny = d.root_cause_category || d.affected_services || d.error_type ||
    d.severity || d.call_chain || d.stack_trace_present != null || d.resolution_status;
  if (!hasAny) return undefined;
  return {
    rootCauseCategory: (d.root_cause_category ?? d.rootCauseCategory) as string | undefined,
    affectedServices: (d.affected_services ?? d.affectedServices) as string[] | undefined,
    errorType: (d.error_type ?? d.errorType) as string | undefined,
    severity: d.severity as string | undefined,
    callChain: (d.call_chain ?? d.callChain) as string | undefined,
    stackTracePresent: (d.stack_trace_present ?? d.stackTracePresent) as boolean | undefined,
    resolutionStatus: (d.resolution_status ?? d.resolutionStatus) as string | undefined,
    semanticSummary: (d.semantic_summary ?? d.semanticSummary) as string | undefined,
  };
}

function toRAGResult(d: Record<string, unknown>): RAGResult {
  return {
    chunkText: (d.chunk_text ?? d.chunkText) as string,
    source: d.source as string,
    sourceType: (d.source_type ?? d.sourceType) as string,
    score: d.score as number,
    retriever: d.retriever as "vector" | "bm25" | "reranker" | "both" | undefined,
    metadata: toRootCauseMetadata(d),
  };
}

export interface LLMConfig {
  provider: "openai" | "anthropic";
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

export interface RAGSearchOptions {
  useHybrid?: boolean;
  useReranker?: boolean;
  useQueryRewriting?: boolean;
  llmConfig?: LLMConfig;
  metadataFilters?: Record<string, string | string[]>;
}

export function buildRAGOptions(
  ragUseHybrid?: boolean,
  ragUseReranker?: boolean,
  ragUseQueryRewriting?: boolean,
  provider?: string,
  apiKey?: string,
  model?: string,
  baseUrl?: string,
  metadataFilters?: Record<string, string | string[]>,
): RAGSearchOptions {
  return {
    useHybrid: ragUseHybrid ?? false,
    useReranker: ragUseReranker ?? false,
    useQueryRewriting: ragUseQueryRewriting ?? false,
    llmConfig: ragUseQueryRewriting && provider && apiKey
      ? { provider: provider as "openai" | "anthropic", apiKey, model, baseUrl }
      : undefined,
    metadataFilters,
  };
}

export async function searchKnowledgeBase(
  query: string,
  topK = 5,
  ragServiceUrl?: string,
  options?: RAGSearchOptions,
): Promise<RAGResult[]> {
  const body: Record<string, unknown> = {
    query,
    top_k: topK,
    use_hybrid: options?.useHybrid ?? false,
    use_reranker: options?.useReranker ?? false,
    use_query_rewriting: options?.useQueryRewriting ?? false,
  };
  if (options?.llmConfig) {
    body.llm_config = {
      provider: options.llmConfig.provider,
      api_key: options.llmConfig.apiKey,
      model: options.llmConfig.model,
      base_url: options.llmConfig.baseUrl,
    };
  }
  if (options?.metadataFilters) {
    body.metadata_filters = options.metadataFilters;
  }
  const res = await fetch(`${baseUrl(ragServiceUrl)}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`RAG search failed: ${res.status}`);
  const data = (await res.json()) as { results: Array<Record<string, unknown>> };
  return data.results.map(toRAGResult);
}

export async function uploadFiles(
  files: File[],
  ragServiceUrl?: string,
): Promise<KBDocument[]> {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  const res = await fetch(`${baseUrl(ragServiceUrl)}/documents/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  const data = (await res.json()) as Array<Record<string, unknown>>;
  return data.map(toKBDocument);
}

export async function addUrl(
  url: string,
  ragServiceUrl?: string,
): Promise<KBDocument> {
  const res = await fetch(`${baseUrl(ragServiceUrl)}/documents/url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(`URL add failed: ${res.status}`);
  const data = (await res.json()) as Record<string, unknown>;
  return toKBDocument(data);
}

export async function uploadIncidentReport(
  report: {
    title: string;
    content: string;
    rootCauseCategory?: string;
    affectedServices?: string[];
    severity?: string;
    callChain?: string;
    resolutionStatus?: "resolved" | "workaround" | "unresolved";
  },
  ragServiceUrl?: string,
): Promise<KBDocument> {
  const res = await fetch(`${baseUrl(ragServiceUrl)}/documents/incident`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: report.title,
      content: report.content,
      source_type: "incident_report",
      root_cause_category: report.rootCauseCategory,
      affected_services: report.affectedServices,
      severity: report.severity,
      call_chain: report.callChain,
      resolution_status: report.resolutionStatus,
    }),
  });
  if (!res.ok) throw new Error(`Incident upload failed: ${res.status}`);
  const data = (await res.json()) as Record<string, unknown>;
  return toKBDocument(data);
}

export async function listDocuments(
  ragServiceUrl?: string,
): Promise<KBDocument[]> {
  const res = await fetch(`${baseUrl(ragServiceUrl)}/documents`);
  if (!res.ok) throw new Error(`List failed: ${res.status}`);
  const data = (await res.json()) as Array<Record<string, unknown>>;
  return data.map(toKBDocument);
}

export async function deleteDocument(
  docId: string,
  ragServiceUrl?: string,
): Promise<void> {
  const res = await fetch(`${baseUrl(ragServiceUrl)}/documents/${docId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
}

export async function checkHealth(
  ragServiceUrl?: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl(ragServiceUrl)}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface AssertionEvaluation {
  query: string;
  relevantDocumentIds: string[];
  groundTruthAnswer: string;
}

export async function evaluateAssertions(
  evaluations: AssertionEvaluation[],
  k: number,
  ragServiceUrl?: string,
  options?: RAGSearchOptions,
): Promise<{ overall: RAGCheckerMetrics; perQuery: Array<{ query: string; metrics: RAGCheckerMetrics }> }> {
  const body: Record<string, unknown> = {
    evaluations: evaluations.map(e => ({
      query: e.query,
      relevant_document_ids: e.relevantDocumentIds,
      ground_truth_answer: e.groundTruthAnswer,
    })),
    k,
    use_hybrid: options?.useHybrid ?? true,
    use_reranker: options?.useReranker ?? true,
    use_query_rewriting: options?.useQueryRewriting ?? true,
  };
  if (options?.llmConfig) {
    body.llm_config = {
      provider: options.llmConfig.provider,
      api_key: options.llmConfig.apiKey,
      model: options.llmConfig.model,
      base_url: options.llmConfig.baseUrl,
    };
  }
  const res = await fetch(`${baseUrl(ragServiceUrl)}/search/evaluate/assertion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Assertion evaluation failed: ${res.status}`);
  return (await res.json()) as { overall: RAGCheckerMetrics; perQuery: Array<{ query: string; metrics: RAGCheckerMetrics }> };
}
