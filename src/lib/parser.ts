import { LogLevel, ParsedLog, LogMetadata } from "./types";
import { detectFormat, detectFramework } from "./detector";

const LEVEL_MAP: Record<string, LogLevel> = {
  error: "ERROR",
  err: "ERROR",
  fatal: "ERROR",
  critical: "ERROR",
  crit: "ERROR",
  warn: "WARN",
  warning: "WARN",
  info: "INFO",
  information: "INFO",
  notice: "INFO",
  debug: "DEBUG",
  trace: "TRACE",
  verbose: "DEBUG",
};

const STACK_TRACE_PATTERNS = [
  /^\s+at\s/,
  /^\s+Caused by:/,
  /^\s+\.\.\.\s+\d+\s+(more|common frames omitted)/,
  /^\s+---/,
  /^\s+Suppressed:/,
  /^\s+by:/,
];

function normalizeLevel(raw: string | number | undefined): LogLevel {
  if (raw === undefined) return "UNKNOWN";
  if (typeof raw === "number") {
    if (raw >= 50) return "ERROR";
    if (raw >= 40) return "WARN";
    if (raw >= 30) return "INFO";
    if (raw >= 20) return "DEBUG";
    return "TRACE";
  }
  return LEVEL_MAP[raw.toLowerCase()] ?? "UNKNOWN";
}

function isStackTrace(line: string): boolean {
  return STACK_TRACE_PATTERNS.some((p) => p.test(line));
}

function parseJsonLine(line: string, lineNum: number): ParsedLog | null {
  try {
    const obj = JSON.parse(line);
    const ts = obj.timestamp || obj.time || obj.ts || obj["@timestamp"] || null;
    const level = normalizeLevel(obj.level ?? obj.severity ?? obj.lvl);
    const message = obj.message || obj.msg || "";
    return {
      line: lineNum,
      timestamp: typeof ts === "number" ? new Date(ts).toISOString() : String(ts ?? ""),
      level,
      message: typeof message === "string" ? message : JSON.stringify(message),
      raw: line,
      isStackTrace: false,
    };
  } catch {
    return null;
  }
}

function parseTextLine(line: string, lineNum: number): ParsedLog {
  const tsMatch = line.match(
    /(\d{4}[-/]\d{2}[-/]\d{2}[\sT]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?Z?)/
  );
  const levelMatch = line.match(
    /\b(ERROR|ERR|FATAL|CRITICAL|WARN|WARNING|INFO|INFORMATION|DEBUG|TRACE|VERBOSE)\b/i
  );
  const level = levelMatch ? normalizeLevel(levelMatch[1]) : "UNKNOWN";
  const stack = isStackTrace(line);

  return {
    line: lineNum,
    timestamp: tsMatch ? tsMatch[1] : null,
    level: stack && level === "UNKNOWN" ? "ERROR" : level,
    message: line.trim(),
    raw: line,
    isStackTrace: stack,
  };
}

export function parseLogs(raw: string): { logs: ParsedLog[]; meta: LogMetadata } {
  const lines = raw.split("\n");
  const format = detectFormat(raw);
  const framework = detectFramework(raw);
  const logs: ParsedLog[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    if (format === "json" || (format === "mixed" && line.trim().startsWith("{"))) {
      const parsed = parseJsonLine(line, i + 1);
      if (parsed) {
        logs.push(parsed);
        continue;
      }
    }
    logs.push(parseTextLine(line, i + 1));
  }

  const errorCount = logs.filter((l) => l.level === "ERROR").length;
  const warnCount = logs.filter((l) => l.level === "WARN").length;

  return {
    logs,
    meta: {
      format,
      framework,
      totalLines: logs.length,
      errorCount,
      warnCount,
    },
  };
}
