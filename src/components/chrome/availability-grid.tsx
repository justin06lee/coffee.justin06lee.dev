"use client";

import * as React from "react";
import { Copy, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** A window on one weekday, in minutes past midnight. */
export type AvailabilityRange = {
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number;
  startMin: number;
  endMin: number;
};

export type AvailabilityGridProps = {
  value: AvailabilityRange[];
  onChange: (ranges: AvailabilityRange[]) => void;
  /** Day names, index-aligned to weekday. Defaults to sun…sat. */
  dayLabels?: string[];
  /** Order the rows are shown in. Defaults to Monday-first. */
  weekOrder?: number[];
  /** Range added when a closed day is switched on. Defaults to 09:00–17:00. */
  defaultRange?: { startMin: number; endMin: number };
  /** Granularity of the time inputs, in minutes. */
  stepMin?: number;
  disabled?: boolean;
  className?: string;
};

const DEFAULT_LABELS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];

function toTimeValue(minutes: number): string {
  const clamped = Math.max(0, Math.min(1439, Math.round(minutes)));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(
    clamped % 60,
  ).padStart(2, "0")}`;
}

function fromTimeValue(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/**
 * The weekly "when am I free" editor.
 *
 * Each day is a switch plus zero or more ranges. Turning a day off keeps
 * nothing — an empty day and a day with no ranges are the same state, so there
 * is no hidden draft to resurrect and surprise someone later.
 *
 * Ranges are validated on change, not on save: an end before its start is
 * flagged inline, and overlapping ranges on the same day are called out, but
 * neither is silently corrected. Rewriting what someone typed is how you end
 * up with a schedule they didn't ask for.
 */
export function AvailabilityGrid({
  value,
  onChange,
  dayLabels = DEFAULT_LABELS,
  weekOrder = MONDAY_FIRST,
  defaultRange = { startMin: 9 * 60, endMin: 17 * 60 },
  stepMin = 15,
  disabled = false,
  className,
}: AvailabilityGridProps) {
  const byDay = React.useMemo(() => {
    const map = new Map<number, AvailabilityRange[]>();
    for (const weekday of weekOrder) map.set(weekday, []);
    for (const range of value) {
      const list = map.get(range.weekday);
      if (list) list.push(range);
    }
    for (const list of map.values()) list.sort((a, b) => a.startMin - b.startMin);
    return map;
  }, [value, weekOrder]);

  function replaceDay(weekday: number, ranges: AvailabilityRange[]) {
    onChange([...value.filter((r) => r.weekday !== weekday), ...ranges]);
  }

  function toggleDay(weekday: number, on: boolean) {
    if (on) {
      replaceDay(weekday, [{ weekday, ...defaultRange }]);
    } else {
      replaceDay(weekday, []);
    }
  }

  function addRange(weekday: number) {
    const existing = byDay.get(weekday) ?? [];
    const last = existing[existing.length - 1];
    // Start the new window an hour after the previous one ends, so the common
    // "morning, then afternoon" shape needs no dragging.
    const startMin = last ? Math.min(23 * 60, last.endMin + 60) : defaultRange.startMin;
    const endMin = Math.min(24 * 60, startMin + (defaultRange.endMin - defaultRange.startMin));
    replaceDay(weekday, [...existing, { weekday, startMin, endMin }]);
  }

  function updateRange(weekday: number, index: number, patch: Partial<AvailabilityRange>) {
    const existing = [...(byDay.get(weekday) ?? [])];
    const target = existing[index];
    if (!target) return;
    existing[index] = { ...target, ...patch };
    replaceDay(weekday, existing);
  }

  function removeRange(weekday: number, index: number) {
    const existing = [...(byDay.get(weekday) ?? [])];
    existing.splice(index, 1);
    replaceDay(weekday, existing);
  }

  /** Push this day's ranges onto every other day that is currently open. */
  function copyToOpenDays(weekday: number) {
    const source = byDay.get(weekday) ?? [];
    const next: AvailabilityRange[] = [];
    for (const day of weekOrder) {
      const existing = byDay.get(day) ?? [];
      if (day === weekday || existing.length > 0) {
        next.push(...source.map((r) => ({ ...r, weekday: day })));
      }
    }
    onChange(next);
  }

  return (
    <div className={cn("flex flex-col", className)}>
      {weekOrder.map((weekday, position) => {
        const ranges = byDay.get(weekday) ?? [];
        const open = ranges.length > 0;

        return (
          <div
            key={weekday}
            className={cn(
              "flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:gap-6",
              position > 0 && "border-t border-white/10",
            )}
          >
            <div className="flex w-40 shrink-0 items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={open}
                disabled={disabled}
                onClick={() => toggleDay(weekday, !open)}
                className={cn(
                  "group flex items-center gap-3 text-left",
                  "focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50",
                  disabled && "cursor-not-allowed opacity-40",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "relative h-4 w-7 shrink-0 border transition-colors",
                    open ? "border-white bg-white/20" : "border-white/25",
                  )}
                >
                  <span
                    className={cn(
                      "absolute left-0.5 top-1/2 size-3 -translate-y-1/2 transition-transform duration-150 ease-out motion-reduce:transition-none",
                      open ? "translate-x-3 bg-white" : "translate-x-0 bg-white/40",
                    )}
                  />
                </span>
                <span className={cn("text-sm", open ? "text-white" : "text-white/40")}>
                  {dayLabels[weekday]}
                </span>
              </button>
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-2">
              {!open ? (
                <span className="py-1.5 text-sm text-white/30">closed</span>
              ) : (
                ranges.map((range, index) => {
                  const inverted = range.endMin <= range.startMin;
                  const overlapping = ranges.some(
                    (other, otherIndex) =>
                      otherIndex !== index &&
                      range.startMin < other.endMin &&
                      other.startMin < range.endMin,
                  );

                  return (
                    <div key={index} className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <input
                          type="time"
                          step={stepMin * 60}
                          disabled={disabled}
                          aria-label={`${dayLabels[weekday]} start`}
                          value={toTimeValue(range.startMin)}
                          onChange={(e) => {
                            const parsed = fromTimeValue(e.target.value);
                            if (parsed !== null) updateRange(weekday, index, { startMin: parsed });
                          }}
                          className={cn(
                            "border bg-transparent px-2 py-1.5 text-sm tabular-nums text-white",
                            "focus:border-white/50 focus:outline-none",
                            inverted ? "border-red-400/60" : "border-white/20",
                          )}
                        />
                        <span aria-hidden className="text-white/30">
                          –
                        </span>
                        <input
                          type="time"
                          step={stepMin * 60}
                          disabled={disabled}
                          aria-label={`${dayLabels[weekday]} end`}
                          value={toTimeValue(range.endMin)}
                          onChange={(e) => {
                            const parsed = fromTimeValue(e.target.value);
                            if (parsed !== null) updateRange(weekday, index, { endMin: parsed });
                          }}
                          className={cn(
                            "border bg-transparent px-2 py-1.5 text-sm tabular-nums text-white",
                            "focus:border-white/50 focus:outline-none",
                            inverted ? "border-red-400/60" : "border-white/20",
                          )}
                        />

                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => removeRange(weekday, index)}
                          aria-label={`remove ${dayLabels[weekday]} window`}
                          className={cn(
                            "p-1.5 text-white/30 transition-colors hover:text-white",
                            "focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50",
                          )}
                        >
                          <X aria-hidden className="size-3.5" strokeWidth={1.5} />
                        </button>

                        {index === 0 ? (
                          <>
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={() => addRange(weekday)}
                              aria-label={`add a ${dayLabels[weekday]} window`}
                              className={cn(
                                "p-1.5 text-white/30 transition-colors hover:text-white",
                                "focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50",
                              )}
                            >
                              <Plus aria-hidden className="size-3.5" strokeWidth={1.5} />
                            </button>
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={() => copyToOpenDays(weekday)}
                              aria-label={`copy ${dayLabels[weekday]} to every open day`}
                              className={cn(
                                "p-1.5 text-white/30 transition-colors hover:text-white",
                                "focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50",
                              )}
                            >
                              <Copy aria-hidden className="size-3.5" strokeWidth={1.5} />
                            </button>
                          </>
                        ) : null}
                      </div>

                      {inverted ? (
                        <p role="alert" className="text-[11px] text-red-300">
                          the end has to come after the start.
                        </p>
                      ) : overlapping ? (
                        <p role="alert" className="text-[11px] text-amber-300/80">
                          this overlaps another window on the same day.
                        </p>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** True when every range is well-formed and no two on a day overlap. */
export function isAvailabilityValid(ranges: AvailabilityRange[]): boolean {
  for (const range of ranges) {
    if (range.endMin <= range.startMin) return false;
  }
  for (const range of ranges) {
    for (const other of ranges) {
      if (other === range || other.weekday !== range.weekday) continue;
      if (range.startMin < other.endMin && other.startMin < range.endMin) return false;
    }
  }
  return true;
}
