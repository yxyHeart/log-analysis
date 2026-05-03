"use client";

import { useState, useRef, useCallback } from "react";

interface LogInputProps {
  onSubmit: (text: string) => void;
  isLoading: boolean;
}

const ACCEPTED_EXTENSIONS = [".log", ".txt", ".json"];

export default function LogInput({ onSubmit, isLoading }: LogInputProps) {
  const [text, setText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setText((prev) => (prev ? prev + "\n" + content : content));
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      e.target.value = "";
    },
    [handleFile]
  );

  const handleSubmit = () => {
    if (text.trim() && !isLoading) {
      onSubmit(text.trim());
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`relative rounded-lg border transition-all duration-300 glow-border-hover ${
          dragOver
            ? "border-[var(--accent-green)]/50 bg-[var(--accent-green-glow)] shadow-[0_0_30px_rgba(0,255,136,0.08)]"
            : "border-[var(--border-dim)] bg-[var(--bg-surface)]/80 hover:border-[var(--border-mid)]"
        }`}
      >
        {/* Terminal-style top bar */}
        <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-[var(--border-dim)]">
          <div className="w-2.5 h-2.5 rounded-full bg-[var(--accent-red)]/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-[var(--accent-amber)]/60" />
          <div className="w-2.5 h-2.5 rounded-full bg-[var(--accent-green)]/60" />
          <span className="ml-3 text-[10px] font-mono text-[var(--text-muted)] tracking-wider">
            {text ? `${text.split("\n").length} lines` : "awaiting input..."}
          </span>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`2025-05-01 14:23:01 ERROR [pool-3] com.app.Service - Connection refused
2025-05-01 14:23:01 WARN  [pool-3] Retrying in 5s...
2025-05-01 14:23:06 ERROR [pool-3] com.app.Service - Still unreachable`}
          className="w-full min-h-[280px] p-4 bg-transparent text-[var(--text-primary)] font-mono text-[12px] leading-[1.7] resize-none outline-none placeholder:text-[var(--text-muted)]/60 placeholder:font-mono"
          disabled={isLoading}
        />

        <input
          ref={fileInputRef}
          type="file"
          accept=".log,.txt,.json"
          onChange={handleFileChange}
          className="hidden"
        />

        {/* Bottom bar */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-[var(--border-dim)]">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono tracking-wider uppercase text-[var(--text-muted)] hover:text-[var(--text-secondary)] border border-transparent hover:border-[var(--border-dim)] rounded transition-all duration-200"
            disabled={isLoading}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Upload
          </button>
          <span className="text-[10px] font-mono text-[var(--text-muted)]">
            .log .txt .json
          </span>
        </div>
      </div>

      <button
        onClick={handleSubmit}
        disabled={!text.trim() || isLoading}
        className="self-end group relative px-8 py-3 rounded font-mono text-[12px] font-semibold tracking-[0.15em] uppercase transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed overflow-hidden"
      >
        {/* Button background with glow */}
        <div className="absolute inset-0 bg-[var(--accent-green)] transition-all duration-300 group-hover:shadow-[0_0_24px_rgba(0,255,136,0.3)]" />
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
        <span className="relative text-[var(--bg-void)]">
          {isLoading ? "Scanning..." : "Analyze"}
        </span>
      </button>
    </div>
  );
}
