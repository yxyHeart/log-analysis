"use client";

import { useState, useEffect } from "react";
import { AnalysisResult } from "@/lib/types";

interface AnalysisPanelProps {
  result: AnalysisResult | null;
  isStreaming: boolean;
  onLineClick?: (line: number) => void;
  thinkingText: string;
  isThinking: boolean;
}

function confidenceStyles(confidence: "high" | "medium" | "low") {
  switch (confidence) {
    case "high":
      return {
        text: "text-[var(--accent-green)]",
        bg: "bg-[var(--accent-green-glow)] border-[var(--accent-green)]/20",
        glow: "shadow-[0_0_20px_rgba(0,255,136,0.06)]",
        dot: "bg-[var(--accent-green)]",
      };
    case "medium":
      return {
        text: "text-[var(--accent-amber)]",
        bg: "bg-[var(--accent-amber-dim)] border-[var(--accent-amber)]/20",
        glow: "",
        dot: "bg-[var(--accent-amber)]",
      };
    case "low":
      return {
        text: "text-[var(--accent-red)]",
        bg: "bg-[var(--accent-red-dim)] border-[var(--accent-red)]/20",
        glow: "",
        dot: "bg-[var(--accent-red)]",
      };
  }
}

function ThinkingSection({ text, isThinking }: { text: string; isThinking: boolean }) {
  const [collapsed, setCollapsed] = useState(false);

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

export default function AnalysisPanel({ result, isStreaming, onLineClick, thinkingText, isThinking }: AnalysisPanelProps) {
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
}
