import type { KBDocument, RAGResult } from "./types";

const DEFAULT_RAG_URL = "http://localhost:8000";

function baseUrl(ragServiceUrl?: string): string {
  return (ragServiceUrl || DEFAULT_RAG_URL).replace(/\/+$/, "");
}

function toKBDocument(d: Record<string, unknown>): KBDocument {
  return {
    docId: (d.doc_id ?? d.docId) as string,
    source: d.source as string,
    sourceType: (d.source_type ?? d.sourceType) as "file" | "url",
    chunkCount: (d.chunk_count ?? d.chunkCount) as number,
    uploadDate: (d.upload_date ?? d.uploadDate) as string,
  };
}

function toRAGResult(d: Record<string, unknown>): RAGResult {
  return {
    chunkText: (d.chunk_text ?? d.chunkText) as string,
    source: d.source as string,
    sourceType: (d.source_type ?? d.sourceType) as string,
    score: d.score as number,
    retriever: d.retriever as "vector" | "bm25" | "reranker" | "both" | undefined,
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
}

export function buildRAGOptions(
  ragUseHybrid?: boolean,
  ragUseReranker?: boolean,
  ragUseQueryRewriting?: boolean,
  provider?: string,
  apiKey?: string,
  model?: string,
  baseUrl?: string,
): RAGSearchOptions {
  return {
    useHybrid: ragUseHybrid ?? false,
    useReranker: ragUseReranker ?? false,
    useQueryRewriting: ragUseQueryRewriting ?? false,
    llmConfig: ragUseQueryRewriting && provider && apiKey
      ? { provider: provider as "openai" | "anthropic", apiKey, model, baseUrl }
      : undefined,
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
