/**
 * iCalendar output and third-party calendar links.
 *
 * Deliberately dependency-free and free of `server-only`: the route handler
 * that serves the .ics and the component that renders "add to calendar" links
 * both need it, and RFC 5545 is small enough at this scope that a library
 * would be more surface than substance.
 */

export type CalendarEvent = {
  /** Stable per booking — a re-download must not create a second event. */
  uid: string;
  start: number;
  end: number;
  title: string;
  description: string;
  location: string;
  /** Shown as the organiser; also the address a reply would go to. */
  organizerName: string;
  organizerEmail?: string;
  attendeeName?: string;
  attendeeEmail?: string;
  /** Cancelled bookings still generate a file, so an invite can be withdrawn. */
  cancelled?: boolean;
  url?: string;
};

/** UTC basic format: 20260805T160000Z. */
export function toIcsStamp(instant: number): string {
  const d = new Date(instant);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return (
    `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/**
 * Escape a TEXT value per RFC 5545 §3.3.11. Order matters: backslashes first,
 * or the escapes added below would themselves be escaped.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Fold to 75 octets per line (RFC 5545 §3.1), continuing with a leading space.
 *
 * The limit is octets, not characters, so folding walks the UTF-8 byte length
 * and never splits a multi-byte character across the boundary — an em dash in
 * a meeting title would otherwise arrive as two mojibake halves.
 */
function fold(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const out: string[] = [];
  let current = "";
  let currentBytes = 0;
  // First line gets 75 octets; continuations lose one to the leading space.
  let limit = 75;

  for (const char of line) {
    const size = encoder.encode(char).length;
    if (currentBytes + size > limit) {
      out.push(current);
      current = "";
      currentBytes = 0;
      limit = 74;
    }
    current += char;
    currentBytes += size;
  }
  if (current) out.push(current);

  return out.join("\r\n ");
}

export function buildIcs(event: CalendarEvent, now = Date.now()): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//coffee.justin06lee.dev//booking//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${event.cancelled ? "CANCEL" : "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${toIcsStamp(now)}`,
    `DTSTART:${toIcsStamp(event.start)}`,
    `DTEND:${toIcsStamp(event.end)}`,
    `SUMMARY:${escapeText(event.title)}`,
    `DESCRIPTION:${escapeText(event.description)}`,
    `LOCATION:${escapeText(event.location)}`,
    `STATUS:${event.cancelled ? "CANCELLED" : "CONFIRMED"}`,
    // A cancellation must carry a higher sequence than the invite it revokes,
    // or clients that already have the event will ignore the update.
    `SEQUENCE:${event.cancelled ? 1 : 0}`,
    "TRANSP:OPAQUE",
  ];

  if (event.organizerEmail) {
    lines.push(
      `ORGANIZER;CN=${escapeText(event.organizerName)}:mailto:${event.organizerEmail}`,
    );
  }
  if (event.attendeeEmail) {
    lines.push(
      `ATTENDEE;CN=${escapeText(event.attendeeName ?? event.attendeeEmail)};` +
        `RSVP=FALSE:mailto:${event.attendeeEmail}`,
    );
  }
  if (event.url) lines.push(`URL:${event.url}`);

  lines.push("END:VEVENT", "END:VCALENDAR");

  // CRLF throughout, including the trailing break — some parsers drop a final
  // line that isn't terminated.
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

/** Google Calendar's event-template URL. */
export function googleCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${toIcsStamp(event.start)}/${toIcsStamp(event.end)}`,
    details: event.description,
    location: event.location,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Outlook Web / Office 365 compose URL. */
export function outlookCalendarUrl(
  event: CalendarEvent,
  variant: "live" | "office" = "live",
): string {
  const host =
    variant === "office"
      ? "https://outlook.office.com/calendar/0/deeplink/compose"
      : "https://outlook.live.com/calendar/0/deeplink/compose";
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: event.title,
    startdt: new Date(event.start).toISOString(),
    enddt: new Date(event.end).toISOString(),
    body: event.description,
    location: event.location,
  });
  return `${host}?${params.toString()}`;
}

/** Yahoo Calendar's add-event URL. Duration is hhmm, not an end stamp. */
export function yahooCalendarUrl(event: CalendarEvent): string {
  const minutes = Math.round((event.end - event.start) / 60_000);
  const duration = `${String(Math.floor(minutes / 60)).padStart(2, "0")}${String(
    minutes % 60,
  ).padStart(2, "0")}`;
  const params = new URLSearchParams({
    v: "60",
    title: event.title,
    st: toIcsStamp(event.start),
    dur: duration,
    desc: event.description,
    in_loc: event.location,
  });
  return `https://calendar.yahoo.com/?${params.toString()}`;
}
