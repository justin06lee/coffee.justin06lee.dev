import { describe, expect, it } from "vitest";
import {
  addDaysToDateKey,
  dateKeyInTimeZone,
  dateKeyRange,
  daysBetweenDateKeys,
  formatDuration,
  formatMinutes,
  formatOffset,
  isValidDateKey,
  isValidTimeZone,
  minutesInTimeZone,
  parseMinutes,
  timeZoneOffsetMs,
  weekdayOfDateKey,
  zonedTimeToInstant,
} from "./time";

const LA = "America/Los_Angeles";
const NY = "America/New_York";
const KOLKATA = "Asia/Kolkata"; // +05:30 — catches half-hour offset bugs
const KATHMANDU = "Asia/Kathmandu"; // +05:45 — catches quarter-hour bugs

describe("zonedTimeToInstant", () => {
  it("resolves a plain winter morning in a western zone", () => {
    // 2026-01-15 09:00 PST is 17:00 UTC.
    const instant = zonedTimeToInstant("2026-01-15", 9 * 60, LA);
    expect(new Date(instant).toISOString()).toBe("2026-01-15T17:00:00.000Z");
  });

  it("resolves a summer morning across the DST change", () => {
    // Same wall clock in July is PDT, one hour further east.
    const instant = zonedTimeToInstant("2026-07-15", 9 * 60, LA);
    expect(new Date(instant).toISOString()).toBe("2026-07-15T16:00:00.000Z");
  });

  it("handles half-hour and quarter-hour offsets", () => {
    expect(new Date(zonedTimeToInstant("2026-03-10", 12 * 60, KOLKATA)).toISOString()).toBe(
      "2026-03-10T06:30:00.000Z",
    );
    expect(
      new Date(zonedTimeToInstant("2026-03-10", 12 * 60, KATHMANDU)).toISOString(),
    ).toBe("2026-03-10T06:15:00.000Z");
  });

  it("round-trips every hour of a normal day", () => {
    for (let m = 0; m < 24 * 60; m += 60) {
      const instant = zonedTimeToInstant("2026-05-20", m, NY);
      expect(minutesInTimeZone(instant, NY)).toBe(m);
      expect(dateKeyInTimeZone(instant, NY)).toBe("2026-05-20");
    }
  });

  it("picks the pre-transition instant in the repeated fall-back hour", () => {
    // 2026-11-01: 01:00-02:00 PDT happens, clocks fall back, 01:00-02:00 PST
    // happens again. 01:30 is ambiguous; we resolve to the first occurrence.
    const instant = zonedTimeToInstant("2026-11-01", 90, LA);
    expect(new Date(instant).toISOString()).toBe("2026-11-01T08:30:00.000Z");
    // Still reads back as 01:30 local, so the slot label is honest.
    expect(minutesInTimeZone(instant, LA)).toBe(90);
  });

  it("does not lose the day in the skipped spring-forward hour", () => {
    // 2026-03-08: 02:00 PST jumps straight to 03:00 PDT, so 02:30 never
    // happens. The contract is that we return a real instant on the right day
    // rather than throwing or rolling into the previous day.
    const instant = zonedTimeToInstant("2026-03-08", 150, LA);
    expect(dateKeyInTimeZone(instant, LA)).toBe("2026-03-08");
    expect(Number.isFinite(instant)).toBe(true);
  });

  it("accepts minutes past the end of the day as a roll into tomorrow", () => {
    const instant = zonedTimeToInstant("2026-05-20", 25 * 60, NY);
    expect(dateKeyInTimeZone(instant, NY)).toBe("2026-05-21");
    expect(minutesInTimeZone(instant, NY)).toBe(60);
  });
});

describe("timeZoneOffsetMs", () => {
  it("is negative west of Greenwich and positive east", () => {
    const winter = Date.UTC(2026, 0, 15, 12);
    expect(timeZoneOffsetMs(winter, LA)).toBe(-8 * 3_600_000);
    expect(timeZoneOffsetMs(winter, KOLKATA)).toBe(5.5 * 3_600_000);
  });

  it("is unaffected by sub-second parts of the instant", () => {
    const base = Date.UTC(2026, 0, 15, 12);
    expect(timeZoneOffsetMs(base + 567, LA)).toBe(timeZoneOffsetMs(base, LA));
  });

  it("tracks daylight saving", () => {
    expect(timeZoneOffsetMs(Date.UTC(2026, 6, 15, 12), LA)).toBe(-7 * 3_600_000);
  });
});

describe("date keys", () => {
  it("adds days across a month and year boundary", () => {
    expect(addDaysToDateKey("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysToDateKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDateKey("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("adds days across a leap day", () => {
    expect(addDaysToDateKey("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysToDateKey("2028-02-29", 1)).toBe("2028-03-01");
  });

  it("does not drift across a DST boundary", () => {
    // The whole reason this is calendar arithmetic and not +86400000ms.
    expect(addDaysToDateKey("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDaysToDateKey("2026-03-08", 1)).toBe("2026-03-09");
  });

  it("measures signed distance", () => {
    expect(daysBetweenDateKeys("2026-01-01", "2026-01-31")).toBe(30);
    expect(daysBetweenDateKeys("2026-01-31", "2026-01-01")).toBe(-30);
    expect(daysBetweenDateKeys("2026-03-07", "2026-03-09")).toBe(2);
  });

  it("knows weekdays", () => {
    expect(weekdayOfDateKey("2026-08-02")).toBe(0); // sunday
    expect(weekdayOfDateKey("2026-08-03")).toBe(1);
    expect(weekdayOfDateKey("2026-08-08")).toBe(6);
  });

  it("builds inclusive ranges", () => {
    expect(dateKeyRange("2026-01-30", "2026-02-02")).toEqual([
      "2026-01-30",
      "2026-01-31",
      "2026-02-01",
      "2026-02-02",
    ]);
    expect(dateKeyRange("2026-01-30", "2026-01-30")).toEqual(["2026-01-30"]);
  });

  it("rejects impossible dates", () => {
    expect(isValidDateKey("2026-08-05")).toBe(true);
    expect(isValidDateKey("2026-02-30")).toBe(false);
    expect(isValidDateKey("2026-13-01")).toBe(false);
    expect(isValidDateKey("2026-8-5")).toBe(false);
    expect(isValidDateKey("nonsense")).toBe(false);
    expect(isValidDateKey("2027-02-29")).toBe(false);
    expect(isValidDateKey("2028-02-29")).toBe(true);
  });
});

describe("dateKeyInTimeZone", () => {
  it("puts an instant on different days in different zones", () => {
    // 2026-08-05 03:00 UTC is still Aug 4 in Los Angeles.
    const instant = Date.UTC(2026, 7, 5, 3);
    expect(dateKeyInTimeZone(instant, "UTC")).toBe("2026-08-05");
    expect(dateKeyInTimeZone(instant, LA)).toBe("2026-08-04");
    expect(dateKeyInTimeZone(instant, KOLKATA)).toBe("2026-08-05");
  });
});

describe("formatting", () => {
  it("formats minutes past midnight", () => {
    expect(formatMinutes(0)).toBe("00:00");
    expect(formatMinutes(9 * 60 + 30)).toBe("09:30");
    expect(formatMinutes(23 * 60 + 59)).toBe("23:59");
    expect(formatMinutes(24 * 60)).toBe("24:00");
  });

  it("parses minutes back", () => {
    expect(parseMinutes("09:30")).toBe(570);
    expect(parseMinutes("9:30")).toBe(570);
    expect(parseMinutes("24:00")).toBe(1440);
    expect(parseMinutes("24:01")).toBeNull();
    expect(parseMinutes("25:00")).toBeNull();
    expect(parseMinutes("09:60")).toBeNull();
    expect(parseMinutes("")).toBeNull();
  });

  it("formats durations", () => {
    expect(formatDuration(15)).toBe("15m");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(90)).toBe("1h 30m");
    expect(formatDuration(125)).toBe("2h 5m");
  });

  it("formats offsets", () => {
    const winter = Date.UTC(2026, 0, 15, 12);
    expect(formatOffset(winter, LA)).toBe("-08:00");
    expect(formatOffset(winter, KOLKATA)).toBe("+05:30");
    expect(formatOffset(winter, KATHMANDU)).toBe("+05:45");
    expect(formatOffset(winter, "UTC")).toBe("+00:00");
  });
});

describe("isValidTimeZone", () => {
  it("accepts real zones and rejects junk", () => {
    expect(isValidTimeZone(LA)).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});
