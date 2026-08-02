"use client";

import * as React from "react";
import { CalendarPlus, Check, Download } from "lucide-react";
import { cn } from "@/lib/utils";

export type CalendarEventInput = {
  title: string;
  /** Epoch ms. */
  start: number;
  /** Epoch ms. */
  end: number;
  description?: string;
  location?: string;
  url?: string;
  /** Stable per event — a re-download must not create a duplicate. */
  uid?: string;
};

export type CalendarTarget = "google" | "outlook" | "office" | "yahoo" | "ics";

export type AddToCalendarProps = {
  event: CalendarEventInput;
  /** Which targets to offer, in order. */
  targets?: CalendarTarget[];
  /**
   * Serve the .ics from your own route instead of the generated blob. Use this
   * when the server already owns the canonical file (so the UID and SEQUENCE
   * match the invite you emailed).
   */
  icsHref?: string;
  /** Filename for the downloaded .ics. */
  filename?: string;
  label?: React.ReactNode;
  /** Lay the targets out as a row of buttons instead of a dropdown. */
  variant?: "menu" | "inline";
  className?: string;
};

const TARGET_LABEL: Record<CalendarTarget, string> = {
  google: "google calendar",
  outlook: "outlook",
  office: "office 365",
  yahoo: "yahoo",
  ics: "download .ics",
};

/** UTC basic format: 20260805T160000Z. */
function stamp(instant: number): string {
  const d = new Date(instant);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return (
    `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** RFC 5545 §3.3.11. Backslashes first, or the escapes below get escaped. */
function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Fold to 75 octets (§3.1), never splitting a multi-byte character. */
function foldIcs(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > limit) {
      out.push(current);
      current = "";
      bytes = 0;
      limit = 74; // continuations lose an octet to the leading space
    }
    current += char;
    bytes += size;
  }
  if (current) out.push(current);
  return out.join("\r\n ");
}

export function buildIcs(event: CalendarEventInput, now = Date.now()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//chrome-ui//add-to-calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid ?? `${event.start}-${event.title}`}`,
    `DTSTAMP:${stamp(now)}`,
    `DTSTART:${stamp(event.start)}`,
    `DTEND:${stamp(event.end)}`,
    `SUMMARY:${escapeIcs(event.title)}`,
    `DESCRIPTION:${escapeIcs(event.description ?? "")}`,
    `LOCATION:${escapeIcs(event.location ?? "")}`,
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
  ];
  if (event.url) lines.push(`URL:${event.url}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return `${lines.map(foldIcs).join("\r\n")}\r\n`;
}

export function calendarUrl(event: CalendarEventInput, target: CalendarTarget): string {
  switch (target) {
    case "google":
      return `https://calendar.google.com/calendar/render?${new URLSearchParams({
        action: "TEMPLATE",
        text: event.title,
        dates: `${stamp(event.start)}/${stamp(event.end)}`,
        details: event.description ?? "",
        location: event.location ?? "",
      })}`;
    case "outlook":
    case "office": {
      const host =
        target === "office"
          ? "https://outlook.office.com/calendar/0/deeplink/compose"
          : "https://outlook.live.com/calendar/0/deeplink/compose";
      return `${host}?${new URLSearchParams({
        path: "/calendar/action/compose",
        rru: "addevent",
        subject: event.title,
        startdt: new Date(event.start).toISOString(),
        enddt: new Date(event.end).toISOString(),
        body: event.description ?? "",
        location: event.location ?? "",
      })}`;
    }
    case "yahoo": {
      const minutes = Math.round((event.end - event.start) / 60_000);
      const dur = `${String(Math.floor(minutes / 60)).padStart(2, "0")}${String(
        minutes % 60,
      ).padStart(2, "0")}`;
      return `https://calendar.yahoo.com/?${new URLSearchParams({
        v: "60",
        title: event.title,
        st: stamp(event.start),
        dur,
        desc: event.description ?? "",
        in_loc: event.location ?? "",
      })}`;
    }
    case "ics":
    default:
      return "";
  }
}

/**
 * "add to calendar" for a confirmed booking — web targets as links, plus a
 * generated .ics for everything else.
 *
 * The .ics is built here rather than fetched so the component works with no
 * backend at all; `icsHref` overrides it when the server owns the canonical
 * file, which matters once an invite has been emailed and the UID has to
 * match. The blob URL is revoked after the click so a page that renders many
 * of these doesn't leak one per event.
 */
export function AddToCalendar({
  event,
  targets = ["google", "outlook", "office", "ics"],
  icsHref,
  filename = "invite.ics",
  label = "add to calendar",
  variant = "menu",
  className,
}: AddToCalendarProps) {
  const [open, setOpen] = React.useState(false);
  const [downloaded, setDownloaded] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  function downloadIcs() {
    if (icsHref) {
      window.location.href = icsHref;
    } else {
      const blob = new Blob([buildIcs(event)], { type: "text/calendar;charset=utf-8" });
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = filename;
      anchor.click();
      // Revoke on the next frame: revoking synchronously can beat the download
      // in some browsers and produce an empty file.
      requestAnimationFrame(() => URL.revokeObjectURL(href));
    }
    setDownloaded(true);
    setOpen(false);
    window.setTimeout(() => setDownloaded(false), 2000);
  }

  const rowClass = cn(
    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-white/70",
    "transition-colors hover:bg-white/10 hover:text-white",
    "focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50",
  );

  const rows = targets.map((target) =>
    target === "ics" ? (
      <button key={target} type="button" onClick={downloadIcs} className={rowClass}>
        <Download aria-hidden className="size-3.5 shrink-0 text-white/40" strokeWidth={1.5} />
        {TARGET_LABEL[target]}
      </button>
    ) : (
      <a
        key={target}
        href={calendarUrl(event, target)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => setOpen(false)}
        className={rowClass}
      >
        <CalendarPlus aria-hidden className="size-3.5 shrink-0 text-white/40" strokeWidth={1.5} />
        {TARGET_LABEL[target]}
      </a>
    ),
  );

  if (variant === "inline") {
    return (
      <div className={cn("flex flex-wrap items-center gap-2", className)}>
        {targets.map((target) =>
          target === "ics" ? (
            <button
              key={target}
              type="button"
              onClick={downloadIcs}
              className={cn(
                "flex items-center gap-2 border border-white/20 px-3 py-1.5 text-sm text-white",
                "transition-colors hover:bg-white/5",
                "focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50",
              )}
            >
              {downloaded ? (
                <Check aria-hidden className="size-3.5" strokeWidth={1.5} />
              ) : (
                <Download aria-hidden className="size-3.5" strokeWidth={1.5} />
              )}
              {downloaded ? "downloaded" : TARGET_LABEL[target]}
            </button>
          ) : (
            <a
              key={target}
              href={calendarUrl(event, target)}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "flex items-center gap-2 border border-white/20 px-3 py-1.5 text-sm text-white",
                "transition-colors hover:bg-white/5",
                "focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50",
              )}
            >
              <CalendarPlus aria-hidden className="size-3.5" strokeWidth={1.5} />
              {TARGET_LABEL[target]}
            </a>
          ),
        )}
        <span aria-live="polite" role="status" className="sr-only">
          {downloaded ? "calendar file downloaded" : ""}
        </span>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={cn("relative inline-block", className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex items-center gap-2 border border-white/20 px-4 py-2 text-sm text-white",
          "transition-colors hover:bg-white/5",
          "focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50",
        )}
      >
        {downloaded ? (
          <Check aria-hidden className="size-3.5" strokeWidth={1.5} />
        ) : (
          <CalendarPlus aria-hidden className="size-3.5" strokeWidth={1.5} />
        )}
        {downloaded ? "downloaded" : label}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute left-0 top-full z-50 mt-1 min-w-52 border border-white/20 bg-[#0a0a0a] py-1"
        >
          {rows}
        </div>
      ) : null}

      <span aria-live="polite" role="status" className="sr-only">
        {downloaded ? "calendar file downloaded" : ""}
      </span>
    </div>
  );
}
