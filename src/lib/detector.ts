import { LogFormat } from "./types";

const JSON_LOG_PATTERN = /^\s*\{[\s\S]*"message"/;
const LOG4J_PATTERN = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[,.]\d+\s+(ERROR|WARN|INFO|DEBUG|TRACE|FATAL)/;
const WINSTON_PATTERN = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[.]\d+z?\s+(error|warn|info|debug|verbose)/i;
const PINO_PATTERN = /^\{"level":\d+,"time":\d+/;
const SPRING_PATTERN = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}[.]\d{3}\s+(ERROR|WARN|INFO|DEBUG|TRACE)/;

export function detectFormat(raw: string): LogFormat {
  const lines = raw.split("\n").filter((l) => l.trim());
  if (lines.length === 0) return "text";

  let jsonCount = 0;
  let textCount = 0;

  for (let i = 0; i < Math.min(lines.length, 50); i++) {
    const line = lines[i].trim();
    if (line.startsWith("{") && line.endsWith("}")) {
      try {
        JSON.parse(line);
        jsonCount++;
        continue;
      } catch {}
    }
    textCount++;
  }

  if (jsonCount > textCount && jsonCount > 0) return "json";
  if (textCount > jsonCount && textCount > 0) return "text";
  return "mixed";
}

export function detectFramework(raw: string): string | null {
  const sample = raw.split("\n").slice(0, 100).join("\n");

  if (PINO_PATTERN.test(sample)) return "pino";
  if (LOG4J_PATTERN.test(sample)) return "log4j";
  if (WINSTON_PATTERN.test(sample)) return "winston";
  if (SPRING_PATTERN.test(sample)) return "spring";

  if (sample.includes("django.") && sample.includes("ERROR")) return "django";
  if (sample.includes("werkzeug")) return "werkzeug";
  if (sample.includes("Rails") || sample.includes("ActiveRecord")) return "rails";

  return null;
}
