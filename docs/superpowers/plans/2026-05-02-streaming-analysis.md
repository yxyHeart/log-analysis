# Streaming Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real-time streaming to the log analysis flow — show LLM thinking text first, then structured analysis results — using a serial dual-endpoint design.

**Architecture:** Two API endpoints called serially from the frontend. First, `/api/analyze/thinking` streams the LLM's reasoning process as text via `streamText()`. When that completes, the existing `/api/analyze` endpoint returns the structured `AnalysisResult` via `generateObject()`. A collapsible "Thinking" section in AnalysisPanel shows the reasoning text with terminal-style streaming.

**Tech Stack:** Next.js 16, Vercel AI SDK v6 (`streamText`, `generateObject`), React 19, Zod v4, Tailwind CSS v4

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/app/api/analyze/thinking/route.ts` | New thinking stream endpoint |
| Modify | `src/lib/prompts.ts` | Add `buildThinkingPrompt()` |
| Modify | `src/app/page.tsx` | Serial two-step call, new state (thinkingText, isThinking, isAnalyzing), phase-aware indicators |
| Modify | `src/components/AnalysisPanel.tsx` | Add collapsible ThinkingSection component, accept new props |

---

### Task 1: Add `buildThinkingPrompt` to prompts.ts

**Files:**
- Modify: `logscope/src/lib/prompts.ts`

- [ ] **Step 1: Add the `buildThinkingPrompt` function**

Add after the existing `buildMergePrompt` function in `src/lib/prompts.ts`:

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
cd logscope
git add src/lib/prompts.ts
git commit -m "feat: add buildThinkingPrompt for streaming analysis phase"
```

---

### Task 2: Create the `/api/analyze/thinking` endpoint

**Files:**
- Create: `logscope/src/app/api/analyze/thinking/route.ts`

- [ ] **Step 1: Create the thinking route file**

Create `src/app/api/analyze/thinking/route.ts`:

```typescript
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
    const logContent = chunks[0]; // condensed or whole — always a single chunk

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
```

- [ ] **Step 2: Commit**

```bash
cd logscope
git add src/app/api/analyze/thinking/route.ts
git commit -m "feat: add /api/analyze/thinking streaming endpoint"
```

---

### Task 3: Add ThinkingSection component to AnalysisPanel

**Files:**
- Modify: `logscope/src/components/AnalysisPanel.tsx`

- [ ] **Step 1: Update the `AnalysisPanelProps` interface**

In `src/components/AnalysisPanel.tsx`, update the props interface:

```typescript
interface AnalysisPanelProps {
  result: AnalysisResult | null;
  isStreaming: boolean;
  onLineClick?: (line: number) => void;
  thinkingText: string;
  isThinking: boolean;
}
```

- [ ] **Step 2: Add the `ThinkingSection` component**

Add before the `AnalysisPanel` function definition:

```typescript
function ThinkingSection({ text, isThinking }: { text: string; isThinking: boolean }) {
  const [collapsed, setCollapsed] = useState(false);

  // Auto-collapse when thinking finishes (isThinking goes false) and there is text
  useEffect(() => {
    if (!isThinking && text) {
      setCollapsed(true);
    }
  }, [isThinking, text]);

  if (!text) return null;

  return (
    <div className="border-b border-[var(--border-dim)]">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-[var(--bg-deep)]/40 hover:bg-[var(--bg-surface)]/40 transition-colors duration-200"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2"
          className={`text-[var(--accent-cyan)] transition-transform duration-200 ${collapsed ? "" : "rotate-90"}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--accent-cyan)]">
          <path d="M12 2a8 8 0 0 1 8 8c0 3-1.5 5-3 6.5V20a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2v-3.5C5.5 15 4 13 4 10a8 8 0 0 1 8-8z" />
          <path d="M9 22h6" />
        </svg>
        <span className="text-[10px] font-mono tracking-[0.15em] text-[var(--accent-cyan)] uppercase">
          Thinking Process
        </span>
        {collapsed && (
          <span className="text-[9px] font-mono text-[var(--text-muted)] ml-1">(collapsed)</span>
        )}
      </button>
      {!collapsed && (
        <div className="px-4 py-3 bg-[var(--bg-void)]/50">
          <pre className="text-[12px] font-mono text-[var(--accent-cyan)]/80 leading-relaxed whitespace-pre-wrap break-words">
            {text}
            {isThinking && <span className="terminal-cursor" />}
          </pre>
        </div>
      )}
    </div>
  );
}
```

Also add the necessary imports at the top of the file:

```typescript
import { useState, useEffect } from "react";
```

- [ ] **Step 3: Integrate ThinkingSection into AnalysisPanel**

Update the `AnalysisPanel` function signature:

```typescript
export default function AnalysisPanel({ result, isStreaming, onLineClick, thinkingText, isThinking }: AnalysisPanelProps) {
```

Update the loading state (replace the existing `isStreaming && !result` block). The thinking section now handles the "active" loading, and the old pulsing dots only show when there's no thinking text yet (i.e., between thinking finishing and analysis starting):

```typescript
  if (isStreaming && !result && !thinkingText && !isThinking) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-4 animate-float-up">
          <div className="flex gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent-green)] animate-glow-pulse" style={{ animationDelay: "0ms" }} />
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent-green)] animate-glow-pulse" style={{ animationDelay: "200ms" }} />
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent-green)] animate-glow-pulse" style={{ animationDelay: "400ms" }} />
          </div>
          <div className="text-center">
            <p className="text-sm font-mono text-phosphor animate-flicker">Preparing analysis</p>
            <p className="text-[10px] font-mono text-[var(--text-muted)] mt-1">
              Initializing...
            </p>
          </div>
        </div>
      </div>
    );
  }
```

Then wrap the result rendering in a fragment that includes the ThinkingSection at the top. Replace the main return (starting at `const cs = confidenceStyles(...)`) with:

```typescript
  const cs = result ? confidenceStyles(result.rootCause.confidence) : null;

  return (
    <div className="h-full flex flex-col bg-[var(--bg-void)]">
      <ThinkingSection text={thinkingText} isThinking={isThinking} />
      {isStreaming && !result && (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4 animate-float-up">
            <div className="flex gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent-green)] animate-glow-pulse" style={{ animationDelay: "0ms" }} />
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent-green)] animate-glow-pulse" style={{ animationDelay: "200ms" }} />
              <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent-green)] animate-glow-pulse" style={{ animationDelay: "400ms" }} />
            </div>
            <div className="text-center">
              <p className="text-sm font-mono text-phosphor animate-flicker">Analyzing</p>
              <p className="text-[10px] font-mono text-[var(--text-muted)] mt-1">
                Generating structured report...
              </p>
            </div>
          </div>
        </div>
      )}
      {result && cs && (
        <div className="flex-1 overflow-auto space-y-1 p-5">
          {/* Root Cause — hero card */}
          <section className="animate-float-up" style={{ animationDelay: "0ms" }}>
            <div className="flex items-center gap-2 mb-3">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--accent-red)]"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              <h3 className="text-[11px] font-mono font-semibold tracking-[0.15em] text-[var(--text-secondary)] uppercase">
                Root Cause
              </h3>
            </div>
            <div className={`rounded-lg p-4 border ${cs.bg} ${cs.glow}`}>
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-1.5 h-1.5 rounded-full ${cs.dot}`} />
                <span className={`text-[10px] font-mono font-semibold tracking-wider uppercase ${cs.text}`}>
                  {result.rootCause.confidence} confidence
                </span>
              </div>
              <p className="text-[13px] text-[var(--text-primary)] leading-relaxed">
                {result.rootCause.description}
              </p>
              {result.rootCause.relatedLines.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {result.rootCause.relatedLines.map((ln) => (
                    <button
                      key={ln}
                      onClick={() => onLineClick?.(ln)}
                      className="px-2 py-0.5 text-[10px] font-mono rounded border border-[var(--border-dim)] bg-[var(--bg-deep)] text-[var(--text-muted)] hover:border-[var(--accent-green)]/30 hover:text-[var(--accent-green)] transition-all duration-200"
                    >
                      L{ln}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Timeline */}
          {result.timeline.length > 0 && (
            <section className="animate-float-up" style={{ animationDelay: "80ms" }}>
              <div className="flex items-center gap-2 mb-3 mt-5">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--accent-cyan)]"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                <h3 className="text-[11px] font-mono font-semibold tracking-[0.15em] text-[var(--text-secondary)] uppercase">
                  Timeline
                </h3>
              </div>
              <div className="relative pl-5 space-y-0">
                <div className="absolute left-[5px] top-1 bottom-1 w-px bg-[var(--border-dim)]" />
                {result.timeline.map((event, i) => (
                  <div key={i} className="relative py-2.5 group">
                    <div
                      className={`absolute -left-[3px] top-3.5 w-[7px] h-[7px] rounded-full border border-[var(--bg-void)] ${
                        event.level === "ERROR"
                          ? "bg-[var(--accent-red)]"
                          : event.level === "WARN"
                          ? "bg-[var(--accent-amber)]"
                          : "bg-[var(--accent-cyan)]"
                      }`}
                    />
                    <div className="ml-3">
                      <div className="flex items-center gap-2 text-[10px] font-mono">
                        <span className="text-[var(--text-muted)]">{event.timestamp || "--:--:--"}</span>
                        <span
                          className={`font-semibold tracking-wider ${
                            event.level === "ERROR"
                              ? "text-[var(--accent-red)]"
                              : event.level === "WARN"
                              ? "text-[var(--accent-amber)]"
                              : "text-[var(--accent-cyan)]"
                          }`}
                        >
                          {event.level}
                        </span>
                      </div>
                      <p className="text-[12px] text-[var(--text-primary)] mt-0.5 leading-relaxed">
                        {event.summary}
                      </p>
                      {event.lineNumbers.length > 0 && (
                        <div className="flex gap-1 mt-1.5">
                          {event.lineNumbers.map((ln) => (
                            <button
                              key={ln}
                              onClick={() => onLineClick?.(ln)}
                              className="px-1.5 py-0.5 text-[9px] font-mono rounded border border-[var(--border-dim)] bg-[var(--bg-deep)] text-[var(--text-muted)] hover:border-[var(--accent-green)]/30 hover:text-[var(--accent-green)] transition-all duration-200"
                            >
                              L{ln}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Fix Suggestions */}
          {result.suggestions.length > 0 && (
            <section className="animate-float-up" style={{ animationDelay: "160ms" }}>
              <div className="flex items-center gap-2 mb-3 mt-5">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--accent-green)]"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                <h3 className="text-[11px] font-mono font-semibold tracking-[0.15em] text-[var(--text-secondary)] uppercase">
                  Suggested Fixes
                </h3>
              </div>
              <div className="space-y-2.5">
                {result.suggestions.map((s, i) => (
                  <div
                    key={i}
                    className="rounded-lg bg-[var(--bg-surface)]/70 border border-[var(--border-dim)] overflow-hidden glow-border-hover transition-all duration-300"
                  >
                    <div className="px-4 py-3">
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 w-5 h-5 rounded flex items-center justify-center text-[10px] font-mono font-bold bg-[var(--accent-green-glow)] text-[var(--accent-green)] shrink-0">
                          {i + 1}
                        </span>
                        <div className="min-w-0">
                          <h4 className="text-[13px] font-medium text-[var(--text-primary)]">
                            {s.title}
                          </h4>
                          <p className="text-[12px] text-[var(--text-secondary)] mt-1 leading-relaxed">
                            {s.description}
                          </p>
                        </div>
                      </div>
                    </div>
                    {s.code && (
                      <div className="relative border-t border-[var(--border-dim)]">
                        <pre className="px-4 py-3 text-[11px] font-mono text-[var(--accent-green)]/80 bg-[var(--bg-void)]/50 overflow-x-auto leading-[1.7]">
                          <code>{s.code}</code>
                        </pre>
                        <button
                          onClick={() => navigator.clipboard.writeText(s.code!)}
                          className="absolute top-2 right-2 px-2 py-1 text-[9px] font-mono tracking-wider uppercase rounded border border-[var(--border-dim)] bg-[var(--bg-deep)] text-[var(--text-muted)] hover:border-[var(--accent-green)]/30 hover:text-[var(--accent-green)] transition-all duration-200"
                        >
                          Copy
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Error List */}
          {result.errors.length > 0 && (
            <section className="animate-float-up" style={{ animationDelay: "240ms" }}>
              <div className="flex items-center gap-2 mb-3 mt-5">
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--accent-red)]"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <h3 className="text-[11px] font-mono font-semibold tracking-[0.15em] text-[var(--text-secondary)] uppercase">
                  Errors
                </h3>
                <span className="text-[10px] font-mono text-[var(--text-muted)]">
                  ({result.errors.length})
                </span>
              </div>
              <div className="space-y-px">
                {result.errors.map((err, i) => (
                  <div
                    key={i}
                    onClick={() => onLineClick?.(err.line)}
                    className="flex items-start gap-2 px-3 py-2 rounded cursor-pointer hover:bg-[var(--bg-surface)]/60 transition-colors duration-150 group"
                  >
                    <span
                      className={`text-[9px] font-mono font-semibold tracking-wider mt-0.5 px-1.5 py-0.5 rounded ${
                        err.level === "ERROR"
                          ? "bg-[var(--accent-red-dim)] text-[var(--accent-red)]"
                          : "bg-[var(--accent-amber-dim)] text-[var(--accent-amber)]"
                      }`}
                    >
                      {err.level}
                    </span>
                    <span className="text-[10px] font-mono text-[var(--text-muted)] mt-0.5 shrink-0">
                      L{err.line}
                    </span>
                    <span className="text-[11px] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors truncate">
                      {err.message}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
      {!result && !isStreaming && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-10 h-10 mx-auto mb-3 rounded-lg border border-[var(--border-dim)] bg-[var(--bg-surface)] flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[var(--text-muted)]"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
            </div>
            <p className="text-xs font-mono text-[var(--text-muted)]">Awaiting analysis</p>
          </div>
        </div>
      )}
    </div>
  );
```

Note: The existing result sections (Root Cause, Timeline, Suggestions, Errors) are kept exactly as-is inside the `{result && cs && (...)}` block. Only the structural wrapper changes — from a single `<div className="h-full overflow-auto space-y-1 p-5 bg-[var(--bg-void)]">` to a flex-column layout with the ThinkingSection on top.

- [ ] **Step 4: Commit**

```bash
cd logscope
git add src/components/AnalysisPanel.tsx
git commit -m "feat: add collapsible ThinkingSection to AnalysisPanel"
```

---

### Task 4: Update page.tsx — serial two-step analysis flow

**Files:**
- Modify: `logscope/src/app/page.tsx`

- [ ] **Step 1: Add new state variables**

In `page.tsx`, after the existing state declarations, add:

```typescript
const [thinkingText, setThinkingText] = useState("");
const [isThinking, setIsThinking] = useState(false);
const [isAnalyzing, setIsAnalyzing] = useState(false);
```

- [ ] **Step 2: Rewrite `handleAnalyze` with serial two-step flow**

Replace the existing `handleAnalyze` callback with:

```typescript
const handleAnalyze = useCallback(
  async (text: string) => {
    if (!settings.apiKey?.trim()) {
      setMissingApiKey(true);
      setSettingsOpen(true);
      return;
    }
    setMissingApiKey(false);
    setRawLog(text);
    const { logs: parsed } = parseLogs(text);
    setLogs(parsed);
    setAnalysisResult(null);
    setAnalysisText("");
    setThinkingText("");
    setHighlightLines([]);
    setViewMode("analysis");

    const reqBody = {
      logText: text,
      provider: settings.provider,
      model: settings.model,
      apiKey: settings.apiKey || undefined,
      baseUrl: settings.baseUrl || undefined,
      ragServiceUrl: settings.ragServiceUrl || undefined,
    };

    // Phase 1: Thinking stream
    setIsThinking(true);
    try {
      const thinkingRes = await fetch("/api/analyze/thinking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      });

      if (thinkingRes.ok && thinkingRes.body) {
        const reader = thinkingRes.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          setThinkingText(accumulated);
        }
      }
    } catch {
      // Thinking stream failed — continue to structured analysis anyway
    }
    setIsThinking(false);

    // Phase 2: Structured analysis
    setIsAnalyzing(true);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      });

      if (!res.ok) {
        let errMsg = `Request failed (${res.status})`;
        try {
          const text = await res.text();
          try {
            const body = JSON.parse(text);
            if (body.error) errMsg = body.error;
          } catch {
            if (text) errMsg = text;
          }
        } catch {}
        throw new Error(errMsg);
      }

      const data = (await res.json()) as AnalysisResult;
      setAnalysisResult(data);
      setAnalysisText(JSON.stringify(data, null, 2));
      setHighlightLines(data.errors?.map((e: { line: number }) => e.line) ?? []);
    } catch (err) {
      setAnalysisResult({
        errors: [],
        timeline: [],
        rootCause: {
          description: `Analysis failed: ${err instanceof Error ? err.message : "Unknown error"}`,
          confidence: "low",
          relatedLines: [],
        },
        suggestions: [],
      });
    } finally {
      setIsAnalyzing(false);
    }
  },
  [settings]
);
```

- [ ] **Step 3: Update phase-aware indicators**

Replace the progress bar condition and the header "SCANNING" text. Change:

```tsx
{isLoading && (
```

to:

```tsx
{(isThinking || isAnalyzing) && (
```

Change the "SCANNING" span:

```tsx
{isLoading && (
  <span className="text-[10px] font-mono text-[var(--accent-green)] animate-glow-pulse ml-1">
    SCANNING
  </span>
)}
```

to:

```tsx
{isThinking && (
  <span className="text-[10px] font-mono text-[var(--accent-cyan)] animate-glow-pulse ml-1">
    THINKING
  </span>
)}
{isAnalyzing && (
  <span className="text-[10px] font-mono text-[var(--accent-green)] animate-glow-pulse ml-1">
    ANALYZING
  </span>
)}
```

- [ ] **Step 4: Pass new props to AnalysisPanel**

Update the `<AnalysisPanel>` component usage:

```tsx
<AnalysisPanel
  result={analysisResult}
  isStreaming={isThinking || isAnalyzing}
  onLineClick={handleLineClick}
  thinkingText={thinkingText}
  isThinking={isThinking}
/>
```

- [ ] **Step 5: Update `handleNewAnalysis` to reset new state**

Add to the `handleNewAnalysis` callback:

```typescript
setThinkingText("");
setIsThinking(false);
setIsAnalyzing(false);
```

Also remove the `isLoading` state variable since it's replaced by `isThinking` and `isAnalyzing`. Remove `const [isLoading, setIsLoading] = useState(false);` and any remaining references to `isLoading` (they've all been replaced in the steps above). The `LogInput` component currently receives `isLoading` — change it to `isThinking || isAnalyzing`:

```tsx
<LogInput onSubmit={handleAnalyze} isLoading={isThinking || isAnalyzing} />
```

- [ ] **Step 6: Commit**

```bash
cd logscope
git add src/app/page.tsx
git commit -m "feat: serial two-step analysis flow with thinking stream"
```

---

### Task 5: Verify end-to-end

- [ ] **Step 1: Start dev server and test the happy path**

```bash
cd logscope
npm run dev
```

1. Open http://localhost:3000
2. Configure an API key in Settings (Anthropic or OpenAI)
3. Paste sample logs and submit
4. Verify: "THINKING" indicator appears, thinking text streams into the collapsible section
5. Verify: After thinking completes, the section auto-collapses and "ANALYZING" indicator appears
6. Verify: Structured analysis results render normally
7. Verify: Clicking the collapsed "Thinking Process" section expands it to show the full text

- [ ] **Step 2: Test error handling**

1. Test with an invalid API key — verify the error appears in the result panel and thinking section doesn't crash
2. Test with RAG service down — verify both thinking and analysis proceed normally

- [ ] **Step 3: Test large logs**

1. Paste a large log (>20k tokens worth of text)
2. Verify thinking phase uses condensed logs and still streams
3. Verify structured analysis still uses chunked merge as before

- [ ] **Step 4: Run build to check for type errors**

```bash
cd logscope
npm run build
```

Expected: Build succeeds with no type errors.

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address issues found during end-to-end verification"
```
