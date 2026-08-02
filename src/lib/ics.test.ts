import { describe, expect, it } from "vitest";
import {
  type CalendarEvent,
  buildIcs,
  googleCalendarUrl,
  outlookCalendarUrl,
  toIcsStamp,
  yahooCalendarUrl,
} from "./ics";

const START = Date.UTC(2026, 7, 5, 16, 0, 0);
const END = Date.UTC(2026, 7, 5, 16, 30, 0);
const NOW = Date.UTC(2026, 7, 1, 12, 0, 0);

function event(patch: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    uid: "abc-123@coffee.justin06lee.dev",
    start: START,
    end: END,
    title: "coffee with justin",
    description: "no agenda",
    location: "google meet",
    organizerName: "justin",
    ...patch,
  };
}

const lines = (ics: string) => ics.split("\r\n");

describe("toIcsStamp", () => {
  it("emits UTC basic format", () => {
    expect(toIcsStamp(START)).toBe("20260805T160000Z");
  });

  it("zero-pads every field", () => {
    expect(toIcsStamp(Date.UTC(2026, 0, 2, 3, 4, 5))).toBe("20260102T030405Z");
  });
});

describe("buildIcs", () => {
  it("produces a well-formed single-event calendar", () => {
    const out = lines(buildIcs(event(), NOW));
    expect(out[0]).toBe("BEGIN:VCALENDAR");
    expect(out).toContain("VERSION:2.0");
    expect(out).toContain("BEGIN:VEVENT");
    expect(out).toContain("UID:abc-123@coffee.justin06lee.dev");
    expect(out).toContain("DTSTAMP:20260801T120000Z");
    expect(out).toContain("DTSTART:20260805T160000Z");
    expect(out).toContain("DTEND:20260805T163000Z");
    expect(out).toContain("SUMMARY:coffee with justin");
    expect(out).toContain("STATUS:CONFIRMED");
    expect(out).toContain("END:VEVENT");
    expect(out).toContain("END:VCALENDAR");
  });

  it("terminates with CRLF", () => {
    expect(buildIcs(event(), NOW).endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("uses CRLF throughout and never a bare LF", () => {
    const ics = buildIcs(event(), NOW);
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("escapes commas, semicolons and backslashes in text", () => {
    const ics = buildIcs(
      event({ title: "coffee, tea; or C:\\code", description: "line one\nline two" }),
      NOW,
    );
    expect(ics).toContain("SUMMARY:coffee\\, tea\\; or C:\\\\code");
    expect(ics).toContain("DESCRIPTION:line one\\nline two");
  });

  it("escapes backslashes before the escapes it adds", () => {
    // A naive order would turn "\," into "\\\\," — the backslash escape has to
    // run first so the comma's own escape isn't double-escaped.
    const ics = buildIcs(event({ title: "a\\,b" }), NOW);
    expect(ics).toContain("SUMMARY:a\\\\\\,b");
  });

  it("folds long lines at 75 octets with a leading-space continuation", () => {
    const long = "x".repeat(200);
    const out = lines(buildIcs(event({ description: long }), NOW));
    for (const line of out) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    const continuations = out.filter((l) => l.startsWith(" "));
    expect(continuations.length).toBeGreaterThan(0);
  });

  it("does not split a multi-byte character across a fold", () => {
    // Em dashes are 3 octets in UTF-8; folding by character count would cut one
    // in half and produce mojibake in the calendar client.
    const ics = buildIcs(event({ description: "—".repeat(60) }), NOW);
    expect(ics).not.toContain("\uFFFD");
    // Unfolding restores the original run intact.
    const unfolded = ics.replace(/\r\n /g, "");
    expect(unfolded).toContain(`DESCRIPTION:${"—".repeat(60)}`);
    for (const line of lines(ics)) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it("marks a cancellation so clients withdraw the invite", () => {
    const out = lines(buildIcs(event({ cancelled: true }), NOW));
    expect(out).toContain("METHOD:CANCEL");
    expect(out).toContain("STATUS:CANCELLED");
    // A higher sequence than the original, or clients ignore the update.
    expect(out).toContain("SEQUENCE:1");
  });

  it("keeps the same uid for the invite and its cancellation", () => {
    const invite = buildIcs(event(), NOW);
    const cancel = buildIcs(event({ cancelled: true }), NOW);
    expect(invite).toContain("UID:abc-123@coffee.justin06lee.dev");
    expect(cancel).toContain("UID:abc-123@coffee.justin06lee.dev");
  });

  it("omits organizer and attendee lines when there is no address", () => {
    const ics = buildIcs(event(), NOW);
    expect(ics).not.toContain("ORGANIZER");
    expect(ics).not.toContain("ATTENDEE");
  });

  it("includes organizer and attendee when addresses are given", () => {
    const ics = buildIcs(
      event({
        organizerEmail: "justin@example.com",
        attendeeName: "sam",
        attendeeEmail: "sam@example.com",
      }),
      NOW,
    );
    expect(ics.replace(/\r\n /g, "")).toContain(
      "ORGANIZER;CN=justin:mailto:justin@example.com",
    );
    expect(ics.replace(/\r\n /g, "")).toContain("ATTENDEE;CN=sam");
  });
});

describe("calendar links", () => {
  it("builds a google template url with a start/end range", () => {
    const url = new URL(googleCalendarUrl(event()));
    expect(url.origin + url.pathname).toBe(
      "https://calendar.google.com/calendar/render",
    );
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("dates")).toBe("20260805T160000Z/20260805T163000Z");
    expect(url.searchParams.get("text")).toBe("coffee with justin");
  });

  it("builds outlook live and office variants", () => {
    expect(outlookCalendarUrl(event())).toContain("outlook.live.com");
    expect(outlookCalendarUrl(event(), "office")).toContain("outlook.office.com");
    const url = new URL(outlookCalendarUrl(event()));
    expect(url.searchParams.get("startdt")).toBe("2026-08-05T16:00:00.000Z");
  });

  it("builds a yahoo url with an hhmm duration", () => {
    const url = new URL(yahooCalendarUrl(event()));
    expect(url.searchParams.get("dur")).toBe("0030");
    expect(url.searchParams.get("st")).toBe("20260805T160000Z");
  });

  it("encodes a 90-minute duration as 0130, not 0090", () => {
    const url = new URL(
      yahooCalendarUrl(event({ end: START + 90 * 60_000 })),
    );
    expect(url.searchParams.get("dur")).toBe("0130");
  });
});
