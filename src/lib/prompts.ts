export const SYSTEM_PROMPT = `You are LogScope, an expert log analysis assistant for developers. You analyze logs to find errors, reconstruct timelines, identify root causes, and suggest fixes. Be precise, actionable, and concise. Always reference specific line numbers when possible. When knowledge base context is provided, use it to supplement your analysis with domain-specific knowledge from the user's documentation.`;

export function buildAnalysisPrompt(logText: string, meta: { format: string; framework: string | null; errorCount: number; warnCount: number }, ragContext?: string): string {
  const ragSection = ragContext ? `\nKnowledge base context (use this to inform your analysis if relevant):\n${ragContext}\n` : "";

  return `Analyze the following log output and produce a structured analysis.

Log metadata:
- Format: ${meta.format}
- Framework: ${meta.framework ?? "unknown"}
- Errors detected by parser: ${meta.errorCount}
- Warnings detected by parser: ${meta.warnCount}
${ragSection}
Perform the following 4-stage analysis:

**Stage 1 - Error Extraction**: List all ERROR and WARN entries with their line numbers and messages. Group related errors together.

**Stage 2 - Timeline Reconstruction**: Build a chronological timeline of significant events, from the first anomaly signal to the final error. Show causation links where possible.

**Stage 3 - Root Cause Analysis**: Identify the most likely root cause. Provide your confidence level (high/medium/low). Reference specific log lines as evidence.

**Stage 4 - Fix Suggestions**: Provide 1-3 actionable fix suggestions. Include code snippets where appropriate.

Respond in the following JSON structure:
{
  "errors": [{ "line": number, "message": string, "level": "ERROR" | "WARN" }],
  "timeline": [{ "timestamp": string, "level": string, "summary": string, "lineNumbers": number[] }],
  "rootCause": { "description": string, "confidence": "high" | "medium" | "low", "relatedLines": number[] },
  "suggestions": [{ "title": string, "description": string, "code": string | null }]
}

Here is the log:
---
${logText}`;
}

export function buildChatPrompt(question: string, logSummary: string, analysisResult: string, ragContext?: string): string {
  const ragSection = ragContext ? `\nKnowledge base context (reference this if relevant to the user's question):\n${ragContext}\n` : "";

  return `The user is asking a follow-up question about log analysis results.

Log summary:
${logSummary}

Analysis results:
${analysisResult}
${ragSection}
User's question: ${question}

Answer based on the log data and analysis above. Reference specific line numbers when relevant.`;
}

export function buildThinkingPrompt(logText: string, meta: { format: string; framework: string | null; errorCount: number; warnCount: number }, ragContext?: string): string {
  const ragSection = ragContext ? `\nKnowledge base context (reference if relevant):\n${ragContext}\n` : "";

  return `You are about to perform a detailed log analysis. First, briefly describe your observations and reasoning before producing the structured report.

Log metadata:
- Format: ${meta.format}
- Framework: ${meta.framework ?? "unknown"}
- Errors detected by parser: ${meta.errorCount}
- Warnings detected by parser: ${meta.warnCount}
${ragSection}
In 2-4 short paragraphs, describe:
1. What patterns or anomalies stand out in these logs
2. Which errors appear related and why
3. Your initial hypothesis about the root cause

Be concise. Do NOT produce structured JSON — just narrate your reasoning briefly. The detailed structured analysis will follow separately.

Here is the log:
---
${logText}`;
}

export function buildMergePrompt(chunkAnalyses: string[]): string {
  return `You have analyzed a large log file in multiple chunks. Merge the following chunk analyses into a single coherent analysis.

${chunkAnalyses.map((a, i) => `--- Chunk ${i + 1} Analysis ---\n${a}`).join("\n\n")}

Produce a merged analysis in the same JSON structure, resolving any contradictions and building a unified timeline.`;
}
