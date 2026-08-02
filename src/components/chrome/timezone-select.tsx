"use client";

import * as React from "react";
import { Check, Globe, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export type TimezoneSelectProps = {
  /** IANA zone name, e.g. "America/Los_Angeles". */
  value: string;
  onChange: (zone: string) => void;
  /**
   * Zones to offer. Defaults to `Intl.supportedValuesOf("timeZone")` where the
   * runtime has it, falling back to a curated list of ~40 common zones.
   */
  zones?: string[];
  /** Mono uppercase caption above the trigger. */
  label?: React.ReactNode;
  placeholder?: string;
  /** Update the clock column every second instead of every minute. */
  liveSeconds?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
};

/** Enough coverage to be useful when `supportedValuesOf` is unavailable. */
const FALLBACK_ZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Toronto",
  "America/Mexico_City",
  "America/Bogota",
  "America/Sao_Paulo",
  "America/Argentina/Buenos_Aires",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Lisbon",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Amsterdam",
  "Europe/Berlin",
  "Europe/Zurich",
  "Europe/Rome",
  "Europe/Stockholm",
  "Europe/Warsaw",
  "Europe/Athens",
  "Europe/Istanbul",
  "Europe/Moscow",
  "Africa/Lagos",
  "Africa/Cairo",
  "Africa/Nairobi",
  "Africa/Johannesburg",
  "Asia/Jerusalem",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Kathmandu",
  "Asia/Dhaka",
  "Asia/Bangkok",
  "Asia/Jakarta",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Seoul",
  "Asia/Tokyo",
  "Australia/Perth",
  "Australia/Brisbane",
  "Australia/Sydney",
  "Pacific/Auckland",
  "Pacific/Honolulu",
];

function defaultZones(): string[] {
  const supported = (
    Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
  ).supportedValuesOf;
  if (typeof supported === "function") {
    try {
      const all = supported("timeZone");
      if (Array.isArray(all) && all.length > 0) return all;
    } catch {
      // fall through
    }
  }
  return FALLBACK_ZONES;
}

/** Offset in minutes, east-positive. Derived via Intl — no zone table needed. */
function offsetMinutes(zone: string, at: Date): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(at);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    const asUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
    );
    return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
  } catch {
    return 0;
  }
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const total = Math.abs(minutes);
  return `utc${sign}${String(Math.floor(total / 60)).padStart(2, "0")}:${String(
    total % 60,
  ).padStart(2, "0")}`;
}

function formatClock(zone: string, at: Date, withSeconds: boolean): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "numeric",
      minute: "2-digit",
      second: withSeconds ? "2-digit" : undefined,
      hour12: true,
    })
      .format(at)
      .toLowerCase();
  } catch {
    return "";
  }
}

/** "America/Los_Angeles" reads as "los angeles · america". */
function prettyZone(zone: string): { city: string; region: string } {
  const parts = zone.split("/");
  const city = (parts[parts.length - 1] ?? zone).replace(/_/g, " ").toLowerCase();
  const region = parts.length > 1 ? (parts[0] ?? "").toLowerCase() : "";
  return { city, region };
}

/**
 * Searchable IANA timezone picker that shows what time it actually is in each
 * zone.
 *
 * `combobox` covers searchable single-select in general, but a zone list is
 * the case where the label alone can't answer the question being asked — the
 * guest is really choosing "the one where it's 4pm right now", so the live
 * clock and the UTC offset are the point rather than decoration.
 *
 * The clock starts null and fills in after mount: seeding it with `new Date()`
 * during render would make the server and client disagree and blow up
 * hydration.
 */
export function TimezoneSelect({
  value,
  onChange,
  zones,
  label,
  placeholder = "search zones…",
  liveSeconds = false,
  disabled = false,
  ariaLabel = "time zone",
  className,
}: TimezoneSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [now, setNow] = React.useState<Date | null>(null);
  const [activeIndex, setActiveIndex] = React.useState(0);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const listboxId = React.useId();

  const allZones = React.useMemo(() => zones ?? defaultZones(), [zones]);

  React.useEffect(() => {
    setNow(new Date());
    const period = liveSeconds ? 1000 : 30_000;
    const id = setInterval(() => setNow(new Date()), period);
    return () => clearInterval(id);
  }, [liveSeconds]);

  const rows = React.useMemo(() => {
    const at = now ?? new Date(0);
    const needle = query.trim().toLowerCase();
    return allZones
      .map((zone) => {
        const { city, region } = prettyZone(zone);
        return { zone, city, region, offset: now ? offsetMinutes(zone, at) : 0 };
      })
      .filter((row) =>
        needle
          ? row.zone.toLowerCase().includes(needle) ||
            row.city.includes(needle) ||
            row.region.includes(needle)
          : true,
      )
      .sort((a, b) => a.offset - b.offset || a.zone.localeCompare(b.zone));
  }, [allZones, query, now]);

  React.useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Outside click and Escape are wired only while open, and torn down on close.
  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Capture phase + stopImmediatePropagation so closing this list doesn't
      // also dismiss a dialog it happens to be sitting inside.
      event.stopImmediatePropagation();
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  React.useEffect(() => {
    if (open) inputRef.current?.focus();
    else setQuery("");
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function handleKeyDown(event: React.KeyboardEvent) {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((i) => Math.min(rows.length - 1, i + 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        break;
      case "Enter": {
        event.preventDefault();
        const row = rows[activeIndex];
        if (row) {
          onChange(row.zone);
          setOpen(false);
        }
        break;
      }
      default:
        break;
    }
  }

  const current = prettyZone(value);
  const currentClock = now ? formatClock(value, now, liveSeconds) : null;

  return (
    <div ref={containerRef} className={cn("relative flex flex-col gap-2", className)}>
      {label ? (
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">
          {label}
        </span>
      ) : null}

      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center justify-between gap-3 border border-white/20 px-3 py-2",
          "text-left text-sm text-white transition-colors hover:border-white/40",
          "focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Globe aria-hidden className="size-3.5 shrink-0 text-white/40" strokeWidth={1.5} />
          <span className="truncate">{current.city}</span>
          {current.region ? (
            <span className="hidden shrink-0 text-white/35 sm:inline">{current.region}</span>
          ) : null}
        </span>
        {/* Suppressed because the clock legitimately differs between the
            server render and the first client tick. */}
        <span suppressHydrationWarning className="shrink-0 font-mono text-[11px] tabular-nums text-white/50">
          {currentClock ?? "—"}
        </span>
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 border border-white/20 bg-[#0a0a0a]">
          <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
            <Search aria-hidden className="size-3.5 shrink-0 text-white/30" strokeWidth={1.5} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              aria-controls={listboxId}
              aria-activedescendant={`${listboxId}-${activeIndex}`}
              className="w-full bg-transparent text-sm text-white placeholder:text-white/30 focus:outline-none"
            />
          </div>

          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            className="max-h-64 overflow-y-auto"
          >
            {rows.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-white/35">no zones match</li>
            ) : (
              rows.map((row, index) => {
                const selected = row.zone === value;
                return (
                  <li
                    key={row.zone}
                    id={`${listboxId}-${index}`}
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => {
                      onChange(row.zone);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm",
                      index === activeIndex ? "bg-white/10 text-white" : "text-white/70",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Check
                        aria-hidden
                        className={cn("size-3 shrink-0", selected ? "text-white" : "text-transparent")}
                        strokeWidth={2}
                      />
                      <span className="truncate">{row.city}</span>
                      {row.region ? (
                        <span className="shrink-0 text-[11px] text-white/30">{row.region}</span>
                      ) : null}
                    </span>
                    <span className="flex shrink-0 items-baseline gap-2 font-mono text-[11px] tabular-nums">
                      <span suppressHydrationWarning className="text-white/60">
                        {now ? formatClock(row.zone, now, false) : ""}
                      </span>
                      <span className="text-white/25">{now ? formatOffset(row.offset) : ""}</span>
                    </span>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
