import { generateObject } from "ai";
import { z } from "zod";
import { parseLogs } from "@/lib/parser";
import { splitForAnalysis } from "@/lib/splitter";
import { SYSTEM_PROMPT, buildAnalysisPrompt, buildMergePrompt } from "@/lib/prompts";
import { getModel } from "@/lib/llm";
import type { Provider } from "@/lib/llm";
import { searchKnowledgeBase, buildRAGOptions } from "@/lib/rag";

const analysisSchema = z.object({
  errors: z.array(z.object({
    line: z.number(),
    message: z.string(),
    level: z.enum(["ERROR", "WARN"]),
  })),
  timeline: z.array(z.object({
    timestamp: z.string(),
    level: z.string(),
    summary: z.string(),
    lineNumbers: z.array(z.number()),
  })),
  rootCause: z.object({
    description: z.string(),
    confidence: z.enum(["high", "medium", "low"]),
    relatedLines: z.array(z.number()),
  }),
  suggestions: z.array(z.object({
    title: z.string(),
    description: z.string(),
    code: z.string().nullable(),
  })),
});

export async function POST(req: Request) {
  const { logText, provider, model, apiKey, baseUrl, ragServiceUrl, ragUseHybrid, ragUseReranker, ragUseQueryRewriting } = await req.json();

  if (!logText?.trim()) {
    return new Response("Log text is required", { status: 400 });
  }

  if (!apiKey?.trim()) {
    return new Response("API key is required. Configure it in Settings.", { status: 401 });
  }

  try {
    const { logs, meta } = parseLogs(logText);
    const { strategy, chunks } = splitForAnalysis(logs);

    // RAG retrieval: query from error/warn messages or log prefix
    let ragContext: string | undefined;
    try {
      const errorLines = logs
        .filter((l) => l.level === "ERROR" || l.level === "WARN")
        .map((l) => l.message)
        .slice(0, 10)
        .join("; ");
      const ragQuery = errorLines || logText.slice(0, 500);
      const ragOptions = buildRAGOptions(ragUseHybrid, ragUseReranker, ragUseQueryRewriting, provider, apiKey, model, baseUrl);
      const ragResults = await searchKnowledgeBase(ragQuery, 5, ragServiceUrl, ragOptions);
      if (ragResults.length > 0) {
        ragContext = ragResults
          .map((r, i) => `[${i + 1}] (from ${r.source}): ${r.chunkText}`)
          .join("\n\n");
      }
    } catch {
      // RAG unavailable — proceed without context
    }

    const modelInstance = getModel(provider as Provider, model, apiKey, baseUrl);

    if (strategy === "chunked" && chunks.length > 1) {
      const chunkResults: string[] = [];

      for (const chunk of chunks) {
        const prompt = buildAnalysisPrompt(chunk, meta, ragContext);
        const result = await generateObject({
          model: modelInstance,
          schema: analysisSchema,
          prompt,
          system: SYSTEM_PROMPT,
        });
        const obj = result.object;
        chunkResults.push(JSON.stringify(obj));
      }

      const mergePrompt = buildMergePrompt(chunkResults);
      const mergeResult = await generateObject({
        model: modelInstance,
        schema: analysisSchema,
        prompt: mergePrompt,
        system: SYSTEM_PROMPT,
      });
      return Response.json(mergeResult.object);
    }

    const prompt = buildAnalysisPrompt(chunks[0], meta, ragContext);

    const result = await generateObject({
      model: modelInstance,
      schema: analysisSchema,
      prompt,
      system: SYSTEM_PROMPT,
    });
    return Response.json(result.object);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Analysis failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
