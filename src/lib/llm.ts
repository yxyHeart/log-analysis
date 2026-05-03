import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";

export type Provider = "openai" | "anthropic";

function normalizeAnthropicBaseURL(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.pathname.endsWith("/v1")) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, "") + "/v1";
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Wraps fetch to patch Anthropic-compatible responses that omit the `signature`
 * field on thinking blocks. The official Anthropic API always includes this field
 * (an integrity token for thinking redaction), but compatible endpoints skip it,
 * causing the AI SDK's zod schema to reject the response.
 */
function patchAnthropicResponse(originalFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    const res = await originalFetch(input, init);
    if (!res.ok) return res;

    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) return res;

    try {
      const text = await res.text();
      const json = JSON.parse(text);

      if (json.type === "message" && Array.isArray(json.content)) {
        let patched = false;
        for (const block of json.content) {
          if (block.type === "thinking" && block.signature === undefined) {
            block.signature = "";
            patched = true;
          }
          if (block.type === "redacted_thinking" && block.signature === undefined) {
            block.signature = "";
            patched = true;
          }
        }
        if (patched) {
          return new Response(JSON.stringify(json), {
            status: res.status,
            statusText: res.statusText,
            headers: res.headers,
          });
        }
      }

      return new Response(text, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    } catch {
      return res;
    }
  };
}

export function getModel(provider: Provider, model: string, apiKey?: string, baseUrl?: string) {
  if (provider === "anthropic") {
    const isCompatible = !!baseUrl;
    const normalizedUrl = baseUrl ? normalizeAnthropicBaseURL(baseUrl) : baseUrl;
    const p = createAnthropic({
      ...(apiKey ? (isCompatible ? { authToken: apiKey } : { apiKey }) : {}),
      ...(normalizedUrl ? { baseURL: normalizedUrl } : {}),
      ...(isCompatible ? { fetch: patchAnthropicResponse(globalThis.fetch) } : {}),
    });
    return p(model || "claude-sonnet-4-6");
  }
  const p = createOpenAI({
    ...(apiKey ? { apiKey } : {}),
    ...(baseUrl ? { baseURL: baseUrl } : {}),
  });
  return p(model || "gpt-4o");
}
