import { streamText } from "ai";
import { SYSTEM_PROMPT, buildChatPrompt } from "@/lib/prompts";
import { getModel } from "@/lib/llm";
import type { Provider } from "@/lib/llm";
import { searchKnowledgeBase, buildRAGOptions } from "@/lib/rag";

export async function POST(req: Request) {
  const { question, logSummary, analysisResult, provider, model, apiKey, baseUrl, ragServiceUrl, ragUseHybrid, ragUseReranker, ragUseQueryRewriting } = await req.json();

  if (!question?.trim()) {
    return new Response("Question is required", { status: 400 });
  }

  if (!apiKey?.trim()) {
    return new Response("API key is required. Configure it in Settings.", { status: 401 });
  }

  try {
    // RAG retrieval
    let ragContext: string | undefined;
    try {
      const ragOptions = buildRAGOptions(ragUseHybrid, ragUseReranker, ragUseQueryRewriting, provider, apiKey, model, baseUrl);
      const ragResults = await searchKnowledgeBase(question, 3, ragServiceUrl, ragOptions);
      if (ragResults.length > 0) {
        ragContext = ragResults
          .map((r, i) => `[${i + 1}] (from ${r.source}): ${r.chunkText}`)
          .join("\n\n");
      }
    } catch {
      // RAG unavailable — proceed without context
    }

    const modelInstance = getModel(provider as Provider, model, apiKey, baseUrl);
    const prompt = buildChatPrompt(question, logSummary ?? "", analysisResult ?? "", ragContext);

    const result = streamText({
      model: modelInstance,
      system: SYSTEM_PROMPT,
      prompt,
    });

    return result.toTextStreamResponse();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Chat request failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
