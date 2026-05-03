import { generateText } from "ai";
import { getModel } from "@/lib/llm";
import type { Provider } from "@/lib/llm";

export async function POST(req: Request) {
  const { provider, model, apiKey, baseUrl } = await req.json();

  if (!apiKey?.trim()) {
    return new Response(JSON.stringify({ ok: false, error: "API key is required" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const finalModel = model?.trim() || (provider === "anthropic" ? "claude-sonnet-4-6" : "gpt-4o");

  try {
    const modelInstance = getModel(provider as Provider, finalModel, apiKey, baseUrl);
    await generateText({
      model: modelInstance,
      prompt: "Reply with OK",
      maxOutputTokens: 5,
    });
    return Response.json({ ok: true, model: finalModel });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Connection failed";
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
