"use client";

import { LogLevel, ParsedLog } from "@/lib/types";

interface LogViewerProps {
  logs: ParsedLog[];
  highlightLines: number[];
  onLineClick?: (line: number) => void;
}

function levelStyles(level: LogLevel, highlighted: boolean): string {
  if (!highlighted) return "text-[var(--text-muted)]";
  switch (level) {
    case "ERROR":
      return "bg-[var(--accent-red-dim)] text-[var(--accent-red)] border-l-2 border-[var(--accent-red)]";
    case "WARN":
      return "bg-[var(--accent-amber-dim)] text-[var(--accent-amber)] border-l-2 border-[var(--accent-amber)]";
    case "INFO":
      return "text-[var(--text-primary)]";
    case "DEBUG":
    case "TRACE":
      return "text-[var(--text-muted)]";
    default:
      return "text-[var(--text-secondary)]";
  }
}

function levelGutter(level: LogLevel): string {
  switch (level) {
    case "ERROR":
      return "bg-[var(--accent-red)]/20 text-[var(--accent-red)]";
    case "WARN":
      return "bg-[var(--accent-amber)]/20 text-[var(--accent-amber)]";
    default:
      return "text-[var(--text-muted)]/50";
  }
}

export default function LogViewer({ logs, highlightLines, onLineClick }: LogViewerProps) {
  const highlightSet = new Set(highlightLines);

  return (
    <div className="h-full overflow-auto font-mono text-[11px] leading-[1.8] bg-[var(--bg-void)]">
      {logs.map((log) => {
        const isHighlighted = highlightSet.has(log.line);

        return (
          <div
            key={log.line}
            data-line={log.line}
            onClick={() => onLineClick?.(log.line)}
            className={`flex cursor-pointer transition-colors duration-150 hover:bg-[var(--bg-elevated)]/50 ${levelStyles(
              log.level,
              isHighlighted
            )} ${log.isStackTrace ? "pl-10" : ""}`}
          >
            <span className="w-8 shrink-0 text-right pr-2 select-none text-[var(--text-muted)]/40">
              {log.line}
            </span>
            {(log.level === "ERROR" || log.level === "WARN") && isHighlighted && (
              <span className={`w-12 shrink-0 text-center px-1 py-px rounded-[3px] text-[8px] font-semibold tracking-wider mr-1.5 self-center ${levelGutter(log.level)}`}>
                {log.level}
              </span>
            )}
            <span className="whitespace-pre-wrap break-all">{log.raw}</span>
          </div>
        );
      })}
    </div>
  );
}
