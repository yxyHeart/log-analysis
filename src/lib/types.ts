export type LogLevel = "ERROR" | "WARN" | "INFO" | "DEBUG" | "TRACE" | "UNKNOWN";

export type LogFormat = "json" | "text" | "mixed";

export interface ParsedLog {
  line: number;
  timestamp: string | null;
  level: LogLevel;
  message: string;
  raw: string;
  isStackTrace: boolean;
}

export interface LogMetadata {
  format: LogFormat;
  framework: string | null;
  totalLines: number;
  errorCount: number;
  warnCount: number;
}

export interface TimelineEvent {
  timestamp: string;
  level: LogLevel;
  summary: string;
  lineNumbers: number[];
}

export interface RootCause {
  description: string;
  confidence: "high" | "medium" | "low";
  relatedLines: number[];
}

export interface FixSuggestion {
  title: string;
  description: string;
  code?: string;
}

export interface AnalysisResult {
  errors: { line: number; message: string; level: LogLevel }[];
  timeline: TimelineEvent[];
  rootCause: RootCause;
  suggestions: FixSuggestion[];
}

// Root cause analysis metadata
export interface RootCauseMetadata {
  rootCauseCategory?: string;
  affectedServices?: string[];
  errorType?: string;
  severity?: string;
  callChain?: string;
  stackTracePresent?: boolean;
  resolutionStatus?: string;
  semanticSummary?: string;
}

export interface KBDocument {
  docId: string;
  source: string;
  sourceType: "file" | "url" | "incident_report";
  chunkCount: number;
  uploadDate: string;
  rootCauseCategory?: string;
  affectedServices?: string[];
  severity?: string;
}

export type RetrieverSource = "vector" | "bm25" | "reranker" | "both";

export interface RAGResult {
  chunkText: string;
  source: string;
  sourceType: string;
  score: number;
  retriever?: RetrieverSource;
  metadata?: RootCauseMetadata;
}

// RAGChecker assertion-level metrics
export interface RAGCheckerMetrics {
  claimRecall: number;
  claimPrecision: number;
  claimF1: number;
  faithfulness: number;
  totalAssertions: number;
  supportedCount: number;
  contradictedCount: number;
  unverifiableCount: number;
  documentRecall: number;
  documentMrr: number;
  documentNdcg: number;
}

// LangGraph pipeline trace
export interface PipelineTrace {
  steps: string[];
  totalLatencyMs: number;
  qualityScore: number;
  qualityPassed: boolean;
  rewriteAttempts: number;
  queryIntent: string;
}
