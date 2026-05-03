"use client";

import { useState, useCallback, useRef } from "react";
import LogInput from "@/components/LogInput";
import LogViewer from "@/components/LogViewer";
import AnalysisPanel from "@/components/AnalysisPanel";
import ChatPanel from "@/components/ChatPanel";
import SettingsPanel, { loadSettings, Provider } from "@/components/SettingsPanel";
import KnowledgeBasePanel from "@/components/KnowledgeBasePanel";
import { parseLogs } from "@/lib/parser";
import { ParsedLog, AnalysisResult } from "@/lib/types";

type ViewMode = "input" | "analysis";

export default function Home() {
  const [viewMode, setViewMode] = useState<ViewMode>("input");
  const [thinkingText, setThinkingText] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [logs, setLogs] = useState<ParsedLog[]>([]);
  const [rawLog, setRawLog] = useState("");
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [analysisText, setAnalysisText] = useState("");
  const [highlightLines, setHighlightLines] = useState<number[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [kbPanelOpen, setKbPanelOpen] = useState(false);
  const [settings, setSettings] = useState(loadSettings);
  const [missingApiKey, setMissingApiKey] = useState(false);
  const logViewerRef = useRef<HTMLDivElement>(null);

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
      setViewMode("analysis");
      setAnalysisResult(null);
      setAnalysisText("");
      setThinkingText("");
      setHighlightLines([]);

      const reqBody = {
        logText: text,
        provider: settings.provider,
        model: settings.model,
        apiKey: settings.apiKey || undefined,
        baseUrl: settings.baseUrl || undefined,
        ragServiceUrl: settings.ragServiceUrl || undefined,
        ragUseHybrid: settings.ragUseHybrid || undefined,
        ragUseReranker: settings.ragUseReranker || undefined,
        ragUseQueryRewriting: settings.ragUseQueryRewriting || undefined,
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

  const handleLineClick = useCallback((line: number) => {
    setHighlightLines([line]);
  }, []);

  const handleNewAnalysis = useCallback(() => {
    setViewMode("input");
    setLogs([]);
    setRawLog("");
    setAnalysisResult(null);
    setAnalysisText("");
    setThinkingText("");
    setIsThinking(false);
    setIsAnalyzing(false);
    setHighlightLines([]);
  }, []);

  return (
    <div className="h-screen flex flex-col relative noise-bg">
      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-5 py-3 border-b border-[var(--border-dim)] bg-[var(--bg-deep)]/80 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-2 h-2 rounded-full bg-[var(--accent-green)] shadow-[0_0_8px_rgba(0,255,136,0.5)] animate-glow-pulse" />
            <h1 className="text-base font-mono font-semibold tracking-widest text-phosphor uppercase">
              LogScope
            </h1>
          </div>
          <span className="text-[10px] font-mono tracking-[0.2em] text-[var(--text-muted)] uppercase hidden sm:inline">
            Forensic Log Analysis
          </span>
        </div>
        <div className="flex items-center gap-2">
          {viewMode === "analysis" && (
            <button
              onClick={handleNewAnalysis}
              className="px-3 py-1.5 text-[11px] font-mono tracking-wider uppercase rounded border border-[var(--border-mid)] text-[var(--text-secondary)] hover:border-[var(--accent-green)]/30 hover:text-[var(--accent-green)] transition-all duration-300"
            >
              New Scan
            </button>
          )}
          <button
            onClick={() => setKbPanelOpen(true)}
            className="p-2 rounded border border-transparent hover:border-[var(--border-mid)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-all duration-300 relative"
            title="Knowledge Base"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            {(settings.ragUseHybrid || settings.ragUseReranker || settings.ragUseQueryRewriting) && (
              <span className="absolute -top-0.5 -right-0.5 flex -space-x-0.5">
                {settings.ragUseHybrid && <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-green)]" />}
                {settings.ragUseReranker && <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-amber)]" />}
                {settings.ragUseQueryRewriting && <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-cyan)]" />}
              </span>
            )}
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="p-2 rounded border border-transparent hover:border-[var(--border-mid)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-all duration-300"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden relative">
        {viewMode === "input" ? (
          <div className="h-full flex flex-col items-center justify-center px-6">
            <div className="w-full max-w-3xl animate-float-up">
              {/* Hero */}
              <div className="text-center mb-10">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[var(--border-dim)] bg-[var(--bg-surface)]/60 mb-6">
                  <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent-green)] animate-glow-pulse" />
                  <span className="text-[10px] font-mono tracking-[0.15em] text-[var(--text-muted)] uppercase">System Online</span>
                </div>
                <h2 className="text-3xl sm:text-4xl font-mono font-bold tracking-tight text-[var(--text-primary)] mb-3">
                  Paste logs.<span className="text-phosphor ml-1">Find the root.</span>
                </h2>
                <p className="text-sm text-[var(--text-secondary)] max-w-md mx-auto leading-relaxed">
                  Drop logs from any framework. AI traces errors, reconstructs timelines,
                  and surfaces the fix.
                </p>
              </div>
              <LogInput onSubmit={handleAnalyze} isLoading={isThinking || isAnalyzing} />
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col">
            {/* Analysis progress bar */}
            {(isThinking || isAnalyzing) && (
              <div className="h-[2px] bg-[var(--bg-deep)] progress-scan">
                <div className="h-full bg-[var(--accent-green)]/40 w-full" />
              </div>
            )}
            <div className="flex-1 flex overflow-hidden">
              {/* Left: Log Viewer */}
              <div className="w-1/2 border-r border-[var(--border-dim)] overflow-hidden flex flex-col" ref={logViewerRef}>
                <div className="px-4 py-2 border-b border-[var(--border-dim)] bg-[var(--bg-deep)]/60 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--text-muted)]"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <span className="text-[11px] font-mono tracking-wider text-[var(--text-muted)] uppercase">
                      Raw Log
                    </span>
                    <span className="text-[10px] font-mono text-[var(--text-muted)]">
                      {logs.length} lines
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-red)]" />
                    <span className="text-[10px] font-mono text-[var(--accent-red)]">
                      {logs.filter((l) => l.level === "ERROR").length}
                    </span>
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-amber)] ml-2" />
                    <span className="text-[10px] font-mono text-[var(--accent-amber)]">
                      {logs.filter((l) => l.level === "WARN").length}
                    </span>
                  </div>
                </div>
                <LogViewer
                  logs={logs}
                  highlightLines={highlightLines}
                  onLineClick={handleLineClick}
                />
              </div>
              {/* Right: Analysis */}
              <div className="w-1/2 overflow-hidden flex flex-col">
                <div className="px-4 py-2 border-b border-[var(--border-dim)] bg-[var(--bg-deep)]/60 flex items-center gap-2 shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--accent-green)]"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                  <span className="text-[11px] font-mono tracking-wider text-[var(--text-muted)] uppercase">
                    AI Analysis
                  </span>
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
                  {(settings.ragUseHybrid || settings.ragUseReranker || settings.ragUseQueryRewriting) && !isThinking && !isAnalyzing && (
                    <span className="flex items-center gap-1 ml-2">
                      {settings.ragUseQueryRewriting && (
                        <span className="text-[8px] font-mono font-bold px-1 py-0.5 rounded bg-[var(--accent-cyan-dim)] text-[var(--accent-cyan)] border border-[rgba(0,212,255,0.25)]">
                          QRW
                        </span>
                      )}
                      {settings.ragUseHybrid && (
                        <span className="text-[8px] font-mono font-bold px-1 py-0.5 rounded bg-[var(--accent-green-glow)] text-[var(--accent-green)] border border-[rgba(0,255,136,0.25)]">
                          HYB
                        </span>
                      )}
                      {settings.ragUseReranker && (
                        <span className="text-[8px] font-mono font-bold px-1 py-0.5 rounded bg-[var(--accent-amber-dim)] text-[var(--accent-amber)] border border-[rgba(255,176,32,0.25)]">
                          RER
                        </span>
                      )}
                    </span>
                  )}
                </div>
                <AnalysisPanel
                  result={analysisResult}
                  isStreaming={isThinking || isAnalyzing}
                  onLineClick={handleLineClick}
                  thinkingText={thinkingText}
                  isThinking={isThinking}
                />
              </div>
            </div>
            {/* Bottom: Chat Panel */}
            <div className="h-auto max-h-72 shrink-0 border-t border-[var(--border-dim)]">
              <ChatPanel
                logSummary={rawLog.slice(0, 3000)}
                analysisResult={analysisText}
                provider={settings.provider}
                model={settings.model}
                apiKey={settings.apiKey}
                baseUrl={settings.baseUrl || ""}
                ragServiceUrl={settings.ragServiceUrl || ""}
                ragUseHybrid={settings.ragUseHybrid}
                ragUseReranker={settings.ragUseReranker}
                ragUseQueryRewriting={settings.ragUseQueryRewriting}
              />
            </div>
          </div>
        )}
      </main>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSettingsChange={setSettings}
      />

      <KnowledgeBasePanel
        open={kbPanelOpen}
        onClose={() => setKbPanelOpen(false)}
        ragServiceUrl={settings.ragServiceUrl || ""}
      />
    </div>
  );
}
