import { ParsedLog } from "./types";

const CONTEXT_WINDOW = 3;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

function isInteresting(log: ParsedLog): boolean {
  return log.level === "ERROR" || log.level === "WARN" || log.isStackTrace;
}

export function splitForAnalysis(logs: ParsedLog[]): {
  strategy: "whole" | "condensed" | "chunked";
  chunks: string[];
} {
  const fullText = logs.map((l) => l.raw).join("\n");
  const tokens = estimateTokens(fullText);

  if (tokens < 4000) {
    return { strategy: "whole", chunks: [fullText] };
  }

  if (tokens < 20000) {
    const condensed = condenseLogs(logs);
    return { strategy: "condensed", chunks: [condensed] };
  }

  return { strategy: "chunked", chunks: chunkLogs(logs) };
}

function condenseLogs(logs: ParsedLog[]): string {
  const included = new Set<number>();

  for (let i = 0; i < logs.length; i++) {
    if (isInteresting(logs[i])) {
      for (
        let j = Math.max(0, i - CONTEXT_WINDOW);
        j <= Math.min(logs.length - 1, i + CONTEXT_WINDOW);
        j++
      ) {
        included.add(j);
      }
    }
  }

  const result: string[] = [];
  let lastIndex = -2;

  for (const idx of Array.from(included).sort((a, b) => a - b)) {
    if (idx > lastIndex + 1) {
      result.push("...");
    }
    result.push(logs[idx].raw);
    lastIndex = idx;
  }

  return result.join("\n");
}

function chunkLogs(logs: ParsedLog[]): string[] {
  const CHUNK_TOKEN_LIMIT = 15000;
  const chunks: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const log of logs) {
    const lineTokens = estimateTokens(log.raw);

    if (currentTokens + lineTokens > CHUNK_TOKEN_LIMIT && current.length > 0) {
      chunks.push(current.join("\n"));
      current = [];
      currentTokens = 0;
    }

    if (isInteresting(log) || currentTokens < CHUNK_TOKEN_LIMIT * 0.3) {
      current.push(log.raw);
      currentTokens += lineTokens;
    }
  }

  if (current.length > 0) {
    chunks.push(current.join("\n"));
  }

  return chunks;
}
