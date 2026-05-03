"use client";

import { useState, useRef, useCallback } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

import { Provider } from "./SettingsPanel";

interface ChatPanelProps {
  logSummary: string;
  analysisResult: string;
  provider: Provider;
  model: string;
  apiKey: string;
  baseUrl: string;
  ragServiceUrl: string;
  ragUseHybrid?: boolean;
  ragUseReranker?: boolean;
  ragUseQueryRewriting?: boolean;
}

export default function ChatPanel({ logSummary, analysisResult, provider, model, apiKey, baseUrl, ragServiceUrl, ragUseHybrid, ragUseReranker, ragUseQueryRewriting }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isStreaming) return;

    const userMsg: Message = { role: "user", content: input.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsStreaming(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: userMsg.content,
          logSummary,
          analysisResult,
          provider,
          model,
          apiKey,
          baseUrl,
          ragServiceUrl,
          ragUseHybrid,
          ragUseReranker,
          ragUseQueryRewriting,
        }),
      });

      if (!res.ok) throw new Error("Chat request failed");

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = "";

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        assistantContent += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content: assistantContent };
          return next;
        });
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Connection failed. Check API key in settings." },
      ]);
    } finally {
      setIsStreaming(false);
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }
  }, [input, isStreaming, logSummary, analysisResult, provider, model, apiKey, baseUrl, ragServiceUrl, ragUseHybrid, ragUseReranker, ragUseQueryRewriting]);

  return (
    <div className="flex flex-col h-full bg-[var(--bg-deep)]/60">
      {/* Header */}
      <div className="px-4 py-2 border-b border-[var(--border-dim)] flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--accent-cyan)]"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span className="text-[10px] font-mono tracking-[0.15em] text-[var(--text-muted)] uppercase">
          Follow-up Questions
        </span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-auto px-4 py-3 space-y-3 max-h-52">
        {messages.length === 0 && (
          <div className="flex items-center justify-center py-3">
            <p className="text-[11px] font-mono text-[var(--text-muted)]">
              Ask about the analysis results
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className="animate-float-up">
            {msg.role === "user" ? (
              <div className="flex items-start gap-2">
                <span className="text-[var(--accent-cyan)] font-mono text-[10px] mt-0.5 shrink-0">
                  &gt;
                </span>
                <p className="text-[12px] text-[var(--text-primary)] leading-relaxed">
                  {msg.content}
                </p>
              </div>
            ) : (
              <div className="flex items-start gap-2 ml-2">
                <span className="text-[var(--accent-green)] font-mono text-[10px] mt-0.5 shrink-0">
                  AI
                </span>
                <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
                  {msg.content}
                  {isStreaming && i === messages.length - 1 && (
                    <span className="terminal-cursor" />
                  )}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="flex gap-2 px-4 py-3 border-t border-[var(--border-dim)]">
        <div className="flex-1 relative">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
            placeholder="Why did that request fail?"
            className="w-full px-3 py-2 pr-10 rounded bg-[var(--bg-surface)]/80 text-[var(--text-primary)] text-[12px] font-mono outline-none border border-[var(--border-dim)] focus:border-[var(--accent-green)]/30 transition-colors duration-300 placeholder:text-[var(--text-muted)]/50"
            disabled={isStreaming}
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-mono text-[var(--text-muted)]/40 pointer-events-none">
            Enter
          </span>
        </div>
        <button
          onClick={sendMessage}
          disabled={isStreaming || !input.trim()}
          className="px-4 py-2 rounded font-mono text-[10px] font-semibold tracking-wider uppercase bg-[var(--accent-green)] text-[var(--bg-void)] hover:shadow-[0_0_16px_rgba(0,255,136,0.25)] disabled:opacity-30 disabled:shadow-none transition-all duration-300"
        >
          Send
        </button>
      </div>
    </div>
  );
}
