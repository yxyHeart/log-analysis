import { streamText } from "ai";
import { parseLogs } from "@/lib/parser";
import { splitForAnalysis } from "@/lib/splitter";
import { SYSTEM_PROMPT, buildThinkingPrompt } from "@/lib/prompts";
import { getModel } from "@/lib/llm";
import type { Provider } from "@/lib/llm";
import { searchKnowledgeBase } from "@/lib/rag";

export async function POST(req: Request) {
  const { logText, provider, model, apiKey, baseUrl, ragServiceUrl } = await req.json();

  if (!logText?.trim()) {
    return new Response("Log text is required", { status: 400 });
  }

  if (!apiKey?.trim()) {
    return new Response("API key is required. Configure it in Settings.", { status: 401 });
  }

  try {
    const { logs, meta } = parseLogs(logText);
    // For thinking: use whole or condensed only (no chunked merge — thinking is a quick overview)
    const { chunks } = splitForAnalysis(logs);
    const logContent = chunks[0];

    // RAG retrieval (same as /api/analyze, non-blocking)
    let ragContext: string | undefined;
    try {
      const errorLines = logs
        .filter((l) => l.level === "ERROR" || l.level === "WARN")
        .map((l) => l.message)
        .slice(0, 10)
        .join("; ");
      const ragQuery = errorLines || logText.slice(0, 500);
      const ragResults = await searchKnowledgeBase(ragQuery, 5, ragServiceUrl);
      if (ragResults.length > 0) {
        ragContext = ragResults
          .map((r, i) => `[${i + 1}] (from ${r.source}): ${r.chunkText}`)
          .join("\n\n");
      }
    } catch {
      // RAG unavailable — proceed without context
    }

    const modelInstance = getModel(provider as Provider, model, apiKey, baseUrl);
    const prompt = buildThinkingPrompt(logContent, meta, ragContext);

    const result = streamText({
      model: modelInstance,
      system: SYSTEM_PROMPT,
      prompt,
    });

    return result.toTextStreamResponse();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Thinking analysis failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
