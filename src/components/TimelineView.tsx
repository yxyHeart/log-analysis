"use client";

import { TimelineEvent } from "@/lib/types";

interface TimelineViewProps {
  events: TimelineEvent[];
  onEventClick?: (lineNumbers: number[]) => void;
}

export default function TimelineView({ events, onEventClick }: TimelineViewProps) {
  if (events.length === 0) {
    return <p className="text-sm text-gray-500">No timeline events.</p>;
  }

  return (
    <div className="relative pl-6 space-y-4">
      <div className="absolute left-[11px] top-2 bottom-2 w-px bg-gray-700" />
      {events.map((event, i) => (
        <div
          key={i}
          className="relative cursor-pointer group"
          onClick={() => onEventClick?.(event.lineNumbers)}
        >
          <div
            className={`absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full border-2 border-gray-900 ${
              event.level === "ERROR"
                ? "bg-red-500"
                : event.level === "WARN"
                ? "bg-yellow-500"
                : "bg-blue-500"
            }`}
          />
          <div className="group-hover:bg-gray-800/50 rounded px-2 py-1 -ml-1 transition-colors">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-gray-400">{event.timestamp || "unknown time"}</span>
              <span
                className={`font-medium ${
                  event.level === "ERROR"
                    ? "text-red-400"
                    : event.level === "WARN"
                    ? "text-yellow-400"
                    : "text-gray-300"
                }`}
              >
                {event.level}
              </span>
            </div>
            <p className="text-sm text-gray-200 mt-0.5">{event.summary}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
