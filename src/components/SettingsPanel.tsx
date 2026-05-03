"use client";

import { useState, useEffect, useCallback } from "react";

export type Provider = "openai" | "anthropic";

interface Settings {
  provider: Provider;
  model: string;
  apiKey: string;
  baseUrl: string;
  ragServiceUrl: string;
  ragUseHybrid: boolean;
  ragUseReranker: boolean;
  ragUseQueryRewriting: boolean;
}

const STORAGE_KEY = "logscope-settings";

const DEFAULT_SETTINGS: Settings = {
  provider: "openai",
  model: "gpt-4o",
  apiKey: "",
  baseUrl: "",
  ragServiceUrl: "http://localhost:8000",
  ragUseHybrid: false,
  ragUseReranker: false,
  ragUseQueryRewriting: false,
};

const PROVIDER_MODELS: Record<Provider, { id: string; name: string }[]> = {
  openai: [
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "gpt-4o-mini", name: "GPT-4o Mini" },
    { id: "gpt-4-turbo", name: "GPT-4 Turbo" },
    { id: "o3", name: "o3" },
    { id: "o4-mini", name: "o4-mini" },
  ],
  anthropic: [
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { id: "claude-opus-4-7", name: "Claude Opus 4.7" },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
  ],
};

export function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_SETTINGS, ...parsed, provider: parsed.provider || "openai" };
    }
  } catch {}
  return DEFAULT_SETTINGS;
}

export function saveSettings(settings: Settings) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  onSettingsChange: (settings: Settings) => void;
}

type TestState = "idle" | "testing" | "success" | "error";

const COLOR_MAP = {
  green: {
    active: "var(--accent-green)",
    glow: "var(--accent-green-glow)",
    dim: "rgba(0,255,136,0.25)",
  },
  amber: {
    active: "var(--accent-amber)",
    glow: "var(--accent-amber-dim)",
    dim: "rgba(255,176,32,0.25)",
  },
  cyan: {
    active: "var(--accent-cyan)",
    glow: "var(--accent-cyan-dim)",
    dim: "rgba(0,212,255,0.25)",
  },
} as const;

type PipelineColor = "green" | "amber" | "cyan";

function PipelineNode({ active, color, label, small }: { active: boolean; color: PipelineColor; label: string; small?: boolean }) {
  const c = COLOR_MAP[color];
  return (
    <div
      className={`flex items-center justify-center rounded font-mono font-bold tracking-wider transition-all duration-300 ${
        small ? "px-1.5 py-0.5 text-[7px]" : "px-2 py-1 text-[8px]"
      }`}
      style={{
        color: active ? c.active : "var(--text-muted)",
        background: active ? c.glow : "var(--bg-surface)",
        border: `1px solid ${active ? c.dim : "var(--border-dim)"}`,
        boxShadow: active ? `0 0 8px ${c.glow}` : "none",
      }}
    >
      {label}
    </div>
  );
}

function PipelineArrow({ dim }: { dim?: boolean }) {
  return (
    <svg width="14" height="8" viewBox="0 0 14 8" className={`shrink-0 ${dim ? "opacity-30" : "opacity-60"}`}>
      <line x1="0" y1="4" x2="9" y2="4" stroke="var(--text-muted)" strokeWidth="1" />
      <polyline points="8,1 12,4 8,7" fill="none" stroke="var(--text-muted)" strokeWidth="1" />
    </svg>
  );
}

function PipelineToggle({ checked, onChange, title, description, accentColor }: {
  checked: boolean;
  onChange: (val: boolean) => void;
  title: string;
  description: string;
  accentColor: PipelineColor;
}) {
  const c = COLOR_MAP[accentColor];
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg border transition-all duration-200 text-left group"
      style={{
        borderColor: checked ? c.dim : "var(--border-dim)",
        background: checked ? c.glow : "transparent",
      }}
    >
      {/* Custom toggle switch */}
      <div
        className="relative w-8 h-[18px] rounded-full shrink-0 transition-colors duration-200"
        style={{ background: checked ? c.active : "var(--border-mid)" }}
      >
        <div
          className="absolute top-[2px] w-[14px] h-[14px] rounded-full transition-all duration-200"
          style={{
            left: checked ? "14px" : "2px",
            background: checked ? "var(--bg-void)" : "var(--text-muted)",
          }}
        />
      </div>
      <div className="min-w-0">
        <div
          className="text-[11px] font-mono font-semibold tracking-wide transition-colors duration-200"
          style={{ color: checked ? c.active : "var(--text-secondary)" }}
        >
          {title}
        </div>
        <div className="text-[9px] font-mono text-[var(--text-muted)] mt-0.5 truncate">
          {description}
        </div>
      </div>
    </button>
  );
}

export default function SettingsPanel({ open, onClose, onSettingsChange }: SettingsPanelProps) {
  const [provider, setProvider] = useState<Provider>(DEFAULT_SETTINGS.provider);
  const [model, setModel] = useState(DEFAULT_SETTINGS.model);
  const [customModel, setCustomModel] = useState("");
  const [apiKey, setApiKey] = useState(DEFAULT_SETTINGS.apiKey);
  const [baseUrl, setBaseUrl] = useState(DEFAULT_SETTINGS.baseUrl);
  const [ragServiceUrl, setRagServiceUrl] = useState(DEFAULT_SETTINGS.ragServiceUrl);
  const [ragUseHybrid, setRagUseHybrid] = useState(DEFAULT_SETTINGS.ragUseHybrid);
  const [ragUseReranker, setRagUseReranker] = useState(DEFAULT_SETTINGS.ragUseReranker);
  const [ragUseQueryRewriting, setRagUseQueryRewriting] = useState(DEFAULT_SETTINGS.ragUseQueryRewriting);
  const [testState, setTestState] = useState<TestState>("idle");
  const [testError, setTestError] = useState("");

  useEffect(() => {
    const saved = loadSettings();
    setProvider(saved.provider);
    setApiKey(saved.apiKey);
    setBaseUrl(saved.baseUrl || "");
    setRagServiceUrl(saved.ragServiceUrl || DEFAULT_SETTINGS.ragServiceUrl);
    setRagUseHybrid(saved.ragUseHybrid ?? DEFAULT_SETTINGS.ragUseHybrid);
    setRagUseReranker(saved.ragUseReranker ?? DEFAULT_SETTINGS.ragUseReranker);
    setRagUseQueryRewriting(saved.ragUseQueryRewriting ?? DEFAULT_SETTINGS.ragUseQueryRewriting);
    const models = PROVIDER_MODELS[saved.provider];
    if (models.some((m) => m.id === saved.model)) {
      setModel(saved.model);
      setCustomModel("");
    } else {
      setModel("custom");
      setCustomModel(saved.model);
    }
    setTestState("idle");
    setTestError("");
  }, [open]);

  const handleProviderChange = useCallback((p: Provider) => {
    setProvider(p);
    setModel(PROVIDER_MODELS[p][0].id);
    setCustomModel("");
    setTestState("idle");
    setTestError("");
  }, []);

  const handleTestConnection = useCallback(async () => {
    if (!apiKey.trim()) return;
    setTestState("testing");
    setTestError("");
    try {
      const finalModel = model === "custom" ? customModel.trim() : model;
      const res = await fetch("/api/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model: finalModel, apiKey, baseUrl: baseUrl.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setTestState("success");
      } else {
        setTestState("error");
        setTestError(data.error || "Connection failed");
      }
    } catch {
      setTestState("error");
      setTestError("Network error");
    }
  }, [provider, model, customModel, apiKey, baseUrl]);

  const handleSave = useCallback(() => {
    const finalModel = model === "custom" ? customModel.trim() : model;
    const settings = { provider, model: finalModel, apiKey, baseUrl: baseUrl.trim(), ragServiceUrl: ragServiceUrl.trim(), ragUseHybrid, ragUseReranker, ragUseQueryRewriting };
    saveSettings(settings);
    onSettingsChange(settings);
    onClose();
  }, [provider, model, customModel, apiKey, baseUrl, ragServiceUrl, ragUseHybrid, ragUseReranker, ragUseQueryRewriting, onSettingsChange, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="glass-panel rounded-xl w-full max-w-md shadow-[0_0_60px_rgba(0,0,0,0.5)] animate-float-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--border-dim)] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded flex items-center justify-center bg-[var(--bg-surface)] border border-[var(--border-dim)]">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--text-muted)]">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </div>
            <h2 className="text-sm font-mono font-semibold tracking-wider text-[var(--text-primary)] uppercase">
              Configuration
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {/* Provider */}
          <div>
            <label className="block text-[10px] font-mono tracking-wider text-[var(--text-muted)] uppercase mb-2">
              Provider
            </label>
            <div className="flex gap-2">
              {(["openai", "anthropic"] as Provider[]).map((p) => (
                <button
                  key={p}
                  onClick={() => handleProviderChange(p)}
                  className={`flex-1 px-3 py-2 rounded-lg font-mono text-[11px] tracking-wider uppercase border transition-all duration-200 ${
                    provider === p
                      ? "border-[var(--accent-green)]/40 bg-[var(--accent-green-glow)] text-[var(--accent-green)]"
                      : "border-[var(--border-dim)] bg-[var(--bg-surface)]/60 text-[var(--text-muted)] hover:border-[var(--border-mid)] hover:text-[var(--text-secondary)]"
                  }`}
                >
                  {p === "openai" ? "OpenAI" : "Anthropic"}
                </button>
              ))}
            </div>
          </div>

          {/* Model */}
          <div>
            <label className="block text-[10px] font-mono tracking-wider text-[var(--text-muted)] uppercase mb-2">
              AI Model
            </label>
            <select
              value={model}
              onChange={(e) => {
                setModel(e.target.value);
                if (e.target.value !== "custom") setCustomModel("");
              }}
              className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg-surface)]/80 text-[var(--text-primary)] text-[13px] font-mono border border-[var(--border-dim)] outline-none focus:border-[var(--accent-green)]/30 transition-colors duration-300 appearance-none cursor-pointer"
            >
              {PROVIDER_MODELS[provider].map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
              <option value="custom">Custom model...</option>
            </select>
            {model === "custom" && (
              <input
                type="text"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                placeholder="e.g. gpt-4.1, claude-3-5-sonnet-latest"
                className="w-full mt-2 px-3 py-2.5 rounded-lg bg-[var(--bg-surface)]/80 text-[var(--text-primary)] text-[13px] font-mono border border-[var(--border-dim)] outline-none focus:border-[var(--accent-green)]/30 transition-colors duration-300 placeholder:text-[var(--text-muted)]/40"
              />
            )}
          </div>

          {/* API Key */}
          <div>
            <label className="block text-[10px] font-mono tracking-wider text-[var(--text-muted)] uppercase mb-2">
              API Key
            </label>
            <div className="relative">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={provider === "openai" ? "sk-..." : "sk-ant-..."}
                className={`w-full px-3 py-2.5 pr-10 rounded-lg bg-[var(--bg-surface)]/80 text-[var(--text-primary)] text-[13px] font-mono border outline-none transition-colors duration-300 placeholder:text-[var(--text-muted)]/40 ${
                  !apiKey.trim()
                    ? "border-[var(--accent-red)]/40"
                    : "border-[var(--border-dim)] focus:border-[var(--accent-green)]/30"
                }`}
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--text-muted)]/40">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
              </div>
            </div>
            {!apiKey.trim() && (
              <p className="text-[10px] font-mono text-[var(--accent-red)] mt-2 flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--accent-red)]"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                API key is required to analyze logs
              </p>
            )}
            {apiKey.trim() && (
              <p className="text-[10px] font-mono text-[var(--text-muted)] mt-2 flex items-center gap-1">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--accent-green)]/50"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                Stored locally in your browser only
              </p>
            )}
          </div>

          {/* Test Connection */}
          <div>
            <button
              onClick={handleTestConnection}
              disabled={!apiKey.trim() || testState === "testing"}
              className="w-full px-3 py-2.5 rounded-lg font-mono text-[11px] tracking-wider uppercase border transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                borderColor: testState === "success"
                  ? "var(--accent-green)"
                  : testState === "error"
                    ? "var(--accent-red)"
                    : "var(--border-dim)",
                backgroundColor: testState === "success"
                  ? "var(--accent-green-glow)"
                  : testState === "error"
                    ? "var(--accent-red-dim)"
                    : "transparent",
                color: testState === "success"
                  ? "var(--accent-green)"
                  : testState === "error"
                    ? "var(--accent-red)"
                    : "var(--text-secondary)",
              }}
            >
              {testState === "testing" && (
                <>
                  <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  Testing...
                </>
              )}
              {testState === "idle" && (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                  Test Connection
                </>
              )}
              {testState === "success" && (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                  Connected
                </>
              )}
              {testState === "error" && (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                  Connection Failed
                </>
              )}
            </button>
            {testState === "error" && testError && (
              <p className="text-[10px] font-mono text-[var(--accent-red)] mt-2 break-all leading-relaxed">
                {testError}
              </p>
            )}
            {testState === "success" && (
              <p className="text-[10px] font-mono text-[var(--accent-green)]/70 mt-2">
                Model is reachable and API key is valid
              </p>
            )}
          </div>

          {/* Base URL */}
          <div>
            <label className="block text-[10px] font-mono tracking-wider text-[var(--text-muted)] uppercase mb-2">
              Compatible API URL
            </label>
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={
                provider === "openai"
                  ? "https://api.openai.com/v1"
                  : "https://api.anthropic.com/v1"
              }
              className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg-surface)]/80 text-[var(--text-primary)] text-[13px] font-mono border border-[var(--border-dim)] outline-none focus:border-[var(--accent-green)]/30 transition-colors duration-300 placeholder:text-[var(--text-muted)]/40"
            />
            <p className="text-[10px] font-mono text-[var(--text-muted)] mt-2">
              Leave empty to use the default endpoint. For compatible providers (e.g. Azure, Together, local models), enter the base URL here.
            </p>
          </div>

          {/* RAG Service URL */}
          <div>
            <label className="block text-[10px] font-mono tracking-wider text-[var(--text-muted)] uppercase mb-2">
              RAG Service URL
            </label>
            <input
              type="url"
              value={ragServiceUrl}
              onChange={(e) => setRagServiceUrl(e.target.value)}
              placeholder="http://localhost:8000"
              className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg-surface)]/80 text-[var(--text-primary)] text-[13px] font-mono border border-[var(--border-dim)] outline-none focus:border-[var(--accent-green)]/30 transition-colors duration-300 placeholder:text-[var(--text-muted)]/40"
            />
            <p className="text-[10px] font-mono text-[var(--text-muted)] mt-2">
              URL of the knowledge base service. Default works for local dev and Docker.
            </p>
          </div>

          {/* RAG Pipeline */}
          <div>
            <label className="block text-[10px] font-mono tracking-wider text-[var(--text-muted)] uppercase mb-3">
              RAG Pipeline
            </label>
            {/* Pipeline flow diagram */}
            <div className="flex items-center gap-1 mb-3 px-1">
              {ragUseQueryRewriting && (
                <>
                  <PipelineNode active={ragUseQueryRewriting} color="cyan" label="QRW" />
                  <PipelineArrow />
                </>
              )}
              {ragUseHybrid ? (
                <>
                  <div className="flex flex-col gap-0.5 items-center">
                    <PipelineNode active small color="green" label="BM25" />
                    <PipelineNode active small color="green" label="VEC" />
                  </div>
                  <PipelineArrow />
                  <PipelineNode active color="green" label="RRF" />
                </>
              ) : (
                <PipelineNode active color="green" label="VEC" />
              )}
              {ragUseReranker && (
                <>
                  <PipelineArrow />
                  <PipelineNode active={ragUseReranker} color="amber" label="RER" />
                </>
              )}
              <PipelineArrow dim />
              <PipelineNode active={false} color="green" label="OUT" />
            </div>
            <div className="space-y-1.5">
              <PipelineToggle
                checked={ragUseHybrid}
                onChange={setRagUseHybrid}
                title="Hybrid Retrieval"
                description="BM25 + Dense Vector + RRF Fusion"
                accentColor="green"
              />
              <PipelineToggle
                checked={ragUseReranker}
                onChange={setRagUseReranker}
                title="Cross-Encoder Reranker"
                description="Two-stage retrieval: coarse → fine"
                accentColor="amber"
              />
              <PipelineToggle
                checked={ragUseQueryRewriting}
                onChange={setRagUseQueryRewriting}
                title="LLM Query Rewriting"
                description="Rewrite & expand queries via LLM"
                accentColor="cyan"
              />
            </div>
            <p className="text-[10px] font-mono text-[var(--text-muted)] mt-2.5">
              Query Rewriting uses your configured LLM provider.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[var(--border-dim)] flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded font-mono text-[11px] tracking-wider text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 rounded font-mono text-[11px] font-semibold tracking-wider uppercase bg-[var(--accent-green)] text-[var(--bg-void)] hover:shadow-[0_0_16px_rgba(0,255,136,0.25)] transition-all duration-300"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
