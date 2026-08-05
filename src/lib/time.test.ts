import { describe, expect, it } from "vitest";
import {
  MINUTES_PER_DAY,
  addDaysToDateKey,
  dateKeyInTimeZone,
  dateKeyRange,
  daysBetweenDateKeys,
  formatDateKey,
  formatDuration,
  formatMinutes,
  formatOffset,
  isValidDateKey,
  isValidTimeZone,
  minutesInTimeZone,
  parseDateKey,
  parseMinutes,
  timeZoneOffsetMs,
  weekdayOfDateKey,
  zonedTimeToInstant,
} from "./time";

const LA = "America/Los_Angeles";
const NY = "America/New_York";
const KOLKATA = "Asia/Kolkata"; // +05:30 — catches half-hour offset bugs
const KATHMANDU = "Asia/Kathmandu"; // +05:45 — catches quarter-hour bugs

// DST is not one behaviour, it is a family of them, and the family members
// disagree. Every zone below breaks a different assumption, and every one of
// them has been the sole zone in some other codebase's DST test.
const BERLIN = "Europe/Berlin"; // northern, and the naive two-pass picks the *second* fall-back hour here
const SYDNEY = "Australia/Sydney"; // southern — spring-forward in October, fall-back in April
const LORD_HOWE = "Australia/Lord_Howe"; // shifts by 30 minutes, not 60
const CHATHAM = "Pacific/Chatham"; // +12:45/+13:45, so its transitions land at :45
const HAVANA = "America/Havana"; // springs forward at 00:00 — the gap is the start of the day
const SANTIAGO = "America/Santiago"; // ditto, southern
const ASUNCION = "America/Asuncion"; // ditto, and stopped observing DST after 2024
const AZORES = "Atlantic/Azores"; // ditto, and its standard offset is -01:00
const NUUK = "America/Nuuk"; // springs forward at 23:00 — the gap runs past midnight

const iso = (instant: number): string => new Date(instant).toISOString();

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

  it("accepts minutes past the end of the day as a roll into tomorrow", () => {
    const instant = zonedTimeToInstant("2026-05-20", 25 * 60, NY);
    expect(dateKeyInTimeZone(instant, NY)).toBe("2026-05-21");
    expect(minutesInTimeZone(instant, NY)).toBe(60);
  });

  it("treats exactly 1440 minutes as midnight starting the next day", () => {
    // The boundary `parseMinutes` and the availability editor both allow, so it
    // has to mean the same thing as asking for 00:00 tomorrow, not roll short.
    const instant = zonedTimeToInstant("2026-05-20", MINUTES_PER_DAY, NY);
    expect(instant).toBe(zonedTimeToInstant("2026-05-21", 0, NY));
    expect(dateKeyInTimeZone(instant, NY)).toBe("2026-05-21");
    expect(minutesInTimeZone(instant, NY)).toBe(0);
  });

  it("resolves wall times from before the epoch", () => {
    // Negative instants exercise every `Math.floor` on the offset path, and
    // 1965 had DST rules of its own — last Sunday in April to last in October.
    const summer = zonedTimeToInstant("1965-07-04", 9 * 60, NY);
    expect(iso(summer)).toBe("1965-07-04T13:00:00.000Z");
    expect(summer).toBeLessThan(0);
    expect(dateKeyInTimeZone(summer, NY)).toBe("1965-07-04");
    expect(minutesInTimeZone(summer, NY)).toBe(9 * 60);
    expect(timeZoneOffsetMs(summer, NY)).toBe(-4 * 3_600_000);

    const winter = zonedTimeToInstant("1965-01-04", 9 * 60, NY);
    expect(iso(winter)).toBe("1965-01-04T14:00:00.000Z");
  });
});

describe("zonedTimeToInstant at a fall-back", () => {
  // The repeated hour has two instants. The contract is the *first*, and it is
  // asserted in zones that disagree about which one falls out of a naive
  // implementation — LA happens to give the right answer by accident, which is
  // exactly how a zone-dependent regression hid here before.
  const CASES: Array<[string, string, number, string]> = [
    [LA, "2026-11-01", 90, "2026-11-01T08:30:00.000Z"],
    [BERLIN, "2026-10-25", 150, "2026-10-25T00:30:00.000Z"],
    [SYDNEY, "2026-04-05", 150, "2026-04-04T15:30:00.000Z"],
    [LORD_HOWE, "2026-04-05", 90, "2026-04-04T14:30:00.000Z"],
    [CHATHAM, "2026-04-05", 195, "2026-04-04T13:30:00.000Z"],
  ];

  it.each(CASES)("returns the first occurrence in %s", (zone, date, minutes, expected) => {
    expect(iso(zonedTimeToInstant(date, minutes, zone))).toBe(expected);
  });

  it.each(CASES)("still reads back as the time asked for in %s", (zone, date, minutes) => {
    const instant = zonedTimeToInstant(date, minutes, zone);
    expect(minutesInTimeZone(instant, zone)).toBe(minutes);
    expect(dateKeyInTimeZone(instant, zone)).toBe(date);
  });

  it("returns the earlier of two instants that both read 02:30 in Berlin", () => {
    // Both of these are 02:30 to a Berliner. The second is what the naive
    // two-pass handed back, so spell it out rather than trusting "first".
    const first = zonedTimeToInstant("2026-10-25", 150, BERLIN);
    const second = first + 3_600_000;
    expect(minutesInTimeZone(first, BERLIN)).toBe(150);
    expect(minutesInTimeZone(second, BERLIN)).toBe(150);
    expect(iso(second)).toBe("2026-10-25T01:30:00.000Z");
  });
});

describe("zonedTimeToInstant at a spring-forward", () => {
  // The skipped hour has no instant at all. The contract is the moment the
  // clock jumped — the first instant that exists at or after what was asked
  // for — never an instant before the jump, which would land on the wrong day
  // in the zones that jump at midnight.
  const CASES: Array<[string, string, number, string, number]> = [
    [LA, "2026-03-08", 120, "2026-03-08T10:00:00.000Z", 180],
    [LA, "2026-03-08", 150, "2026-03-08T10:00:00.000Z", 180],
    [BERLIN, "2026-03-29", 120, "2026-03-29T01:00:00.000Z", 180],
    [BERLIN, "2026-03-29", 150, "2026-03-29T01:00:00.000Z", 180],
    [SYDNEY, "2026-10-04", 150, "2026-10-03T16:00:00.000Z", 180],
    [LORD_HOWE, "2026-10-04", 120, "2026-10-03T15:30:00.000Z", 150],
    [LORD_HOWE, "2026-10-04", 135, "2026-10-03T15:30:00.000Z", 150],
    [CHATHAM, "2026-09-27", 165, "2026-09-26T14:00:00.000Z", 225],
    [HAVANA, "2026-03-08", 0, "2026-03-08T05:00:00.000Z", 60],
    [HAVANA, "2026-03-08", 30, "2026-03-08T05:00:00.000Z", 60],
    [SANTIAGO, "2026-09-06", 30, "2026-09-06T04:00:00.000Z", 60],
    [AZORES, "2026-03-29", 30, "2026-03-29T01:00:00.000Z", 60],
    [ASUNCION, "2024-10-06", 30, "2024-10-06T04:00:00.000Z", 60],
  ];

  it.each(CASES)(
    "snaps to the instant the clock jumped to in %s",
    (zone, date, minutes, expected, readback) => {
      const instant = zonedTimeToInstant(date, minutes, zone);
      expect(iso(instant)).toBe(expected);
      expect(minutesInTimeZone(instant, zone)).toBe(readback);
      expect(readback).toBeGreaterThanOrEqual(minutes);
    },
  );

  it("stays on the requested day when the jump is at midnight", () => {
    // The bug this replaced: 00:00 in a zone that springs forward at 00:00
    // resolved to 23:00 the *previous* day, so the slot could be offered on a
    // page it could never be booked from.
    const MIDNIGHT_JUMPS: Array<[string, string[]]> = [
      [
        HAVANA,
        [
          "2024-03-10",
          "2025-03-09",
          "2026-03-08",
          "2027-03-14",
          "2028-03-12",
          "2029-03-11",
          "2030-03-10",
          "2031-03-09",
        ],
      ],
      [
        SANTIAGO,
        [
          "2024-09-08",
          "2025-09-07",
          "2026-09-06",
          "2027-09-05",
          "2028-09-03",
          "2029-09-02",
          "2030-09-08",
          "2031-09-07",
        ],
      ],
      [ASUNCION, ["2024-10-06"]],
      [
        AZORES,
        [
          "2024-03-31",
          "2025-03-30",
          "2026-03-29",
          "2027-03-28",
          "2028-03-26",
          "2029-03-25",
          "2030-03-31",
          "2031-03-30",
        ],
      ],
    ];
    const drifted: string[] = [];
    for (const [zone, dates] of MIDNIGHT_JUMPS) {
      for (const date of dates) {
        for (let m = 0; m < MINUTES_PER_DAY; m += 15) {
          const landed = dateKeyInTimeZone(zonedTimeToInstant(date, m, zone), zone);
          if (landed !== date) drifted.push(`${zone} ${date} ${formatMinutes(m)} -> ${landed}`);
        }
      }
    }
    expect(drifted).toEqual([]);
  });

  it("cannot stay on the day when the jump runs past midnight", () => {
    // Nuuk goes 23:00 -> 00:00, so 2026-03-28 23:30 is not a time that ever
    // happened and no instant reads back on that date. Pinned rather than
    // fixed: forward to the next real instant beats backward off the day.
    expect(iso(zonedTimeToInstant("2026-03-28", 22 * 60 + 59, NUUK))).toBe(
      "2026-03-29T00:59:00.000Z",
    );
    expect(dateKeyInTimeZone(zonedTimeToInstant("2026-03-28", 22 * 60 + 59, NUUK), NUUK)).toBe(
      "2026-03-28",
    );
    const skipped = zonedTimeToInstant("2026-03-28", 23 * 60 + 30, NUUK);
    expect(iso(skipped)).toBe("2026-03-29T01:00:00.000Z");
    expect(dateKeyInTimeZone(skipped, NUUK)).toBe("2026-03-29");
  });

  it("never walks backwards across a spring-forward day", () => {
    // `slotsForDate` sorts and dedups, so a step backwards here is invisible
    // downstream — which is why nothing caught it. Pin the raw sequence.
    const DAYS: Array<[string, string, number]> = [
      [LA, "2026-03-08", 92],
      [BERLIN, "2026-03-29", 92],
      [SYDNEY, "2026-10-04", 92],
      [LORD_HOWE, "2026-10-04", 94], // only 30 minutes are skipped, so only 2 collide
      [HAVANA, "2026-03-08", 92],
      [CHATHAM, "2026-09-27", 92],
    ];
    for (const [zone, date, distinct] of DAYS) {
      const walked: number[] = [];
      for (let m = 0; m < MINUTES_PER_DAY; m += 15) {
        walked.push(zonedTimeToInstant(date, m, zone));
      }
      for (let i = 1; i < walked.length; i += 1) {
        expect(walked[i]).toBeGreaterThanOrEqual(walked[i - 1]);
      }
      // A day that loses an hour has fewer instants than wall-clock readings,
      // so some collision is forced — but only as many as the gap is wide.
      expect(new Set(walked).size).toBe(distinct);
    }
  });

  it("never walks backwards across a fall-back day either", () => {
    for (const [zone, date] of [
      [LA, "2026-11-01"],
      [BERLIN, "2026-10-25"],
      [SYDNEY, "2026-04-05"],
      [LORD_HOWE, "2026-04-05"],
    ] as const) {
      let previous = Number.NEGATIVE_INFINITY;
      for (let m = 0; m < MINUTES_PER_DAY; m += 15) {
        const instant = zonedTimeToInstant(date, m, zone);
        expect(instant).toBeGreaterThan(previous);
        previous = instant;
      }
    }
  });
});

describe("zonedTimeToInstant round-trip property", () => {
  it("lands on the requested day for every quarter hour of a year", () => {
    // The invariant every caller leans on. A year covers both transitions and
    // the 363 days that must not regress while chasing the two that do.
    const drifted: string[] = [];
    for (const zone of [HAVANA, BERLIN, CHATHAM, LORD_HOWE]) {
      for (const date of dateKeyRange("2026-01-01", "2026-12-31")) {
        for (let m = 0; m < MINUTES_PER_DAY; m += 15) {
          const landed = dateKeyInTimeZone(zonedTimeToInstant(date, m, zone), zone);
          if (landed !== date) drifted.push(`${zone} ${date} ${formatMinutes(m)} -> ${landed}`);
        }
      }
    }
    expect(drifted).toEqual([]);
  });

  it("reads back the exact minute asked for whenever that minute exists", () => {
    // Outside a gap the conversion has to be lossless in both directions.
    const lossy: string[] = [];
    for (const zone of [LA, BERLIN, SYDNEY, KATHMANDU, AZORES]) {
      for (const date of dateKeyRange("2026-06-01", "2026-06-14")) {
        for (let m = 0; m < MINUTES_PER_DAY; m += 15) {
          const instant = zonedTimeToInstant(date, m, zone);
          if (minutesInTimeZone(instant, zone) !== m || dateKeyInTimeZone(instant, zone) !== date) {
            lossy.push(`${zone} ${date} ${formatMinutes(m)}`);
          }
        }
      }
    }
    expect(lossy).toEqual([]);
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

  it("throws on a key it cannot parse", () => {
    expect(() => parseDateKey("2026-8-5")).toThrow(/invalid date key/);
    expect(() => parseDateKey("")).toThrow(/invalid date key/);
    expect(() => parseDateKey("2026-08-05T09:00")).toThrow(/invalid date key/);
    expect(() => parseDateKey(" 2026-08-05")).toThrow(/invalid date key/);
    expect(parseDateKey("2026-08-05")).toEqual({ year: 2026, month: 8, day: 5 });
  });

  it("keeps years under 1000 intact", () => {
    // `Date.UTC(50, …)` means 1950 and an unpadded year prints as "100-01-02",
    // so a first-millennium key used to come back as a different key entirely —
    // sometimes one that no longer matches the key format at all.
    expect(formatDateKey(50, 1, 1)).toBe("0050-01-01");
    expect(formatDateKey(100, 1, 2)).toBe("0100-01-02");
    expect(addDaysToDateKey("0050-01-01", 1)).toBe("0050-01-02");
    expect(addDaysToDateKey("0099-12-31", 1)).toBe("0100-01-01");
    expect(addDaysToDateKey("0100-01-01", 1)).toBe("0100-01-02");
    expect(addDaysToDateKey("0001-01-01", -1)).toBe("0000-12-31");
    expect(daysBetweenDateKeys("0050-01-01", "0050-03-01")).toBe(59); // 50 is not a leap year
    expect(weekdayOfDateKey("0050-01-01")).toBe(6);
    expect(dateKeyRange("0099-12-30", "0100-01-01")).toEqual([
      "0099-12-30",
      "0099-12-31",
      "0100-01-01",
    ]);
  });

  it("applies the Gregorian leap rule to first-millennium years too", () => {
    expect(isValidDateKey("0050-01-01")).toBe(true);
    expect(isValidDateKey("0000-02-29")).toBe(true); // divisible by 400
    expect(isValidDateKey("0100-02-29")).toBe(false); // century, not divisible by 400
    expect(isValidDateKey("0400-02-29")).toBe(true);
    expect(isValidDateKey("0050-02-29")).toBe(false);
  });

  it("hands a valid key back for every valid key it is given", () => {
    // The property the padding exists for: nothing in this family may produce a
    // key its own validator would reject.
    const broken: string[] = [];
    for (const key of [
      "0001-06-15",
      "0050-06-15",
      "0099-12-31",
      "0100-01-01",
      "0999-12-31",
      "1000-01-01",
      "2026-08-05",
      "9998-06-15",
    ]) {
      for (const days of [-400, -1, 0, 1, 400]) {
        const shifted = addDaysToDateKey(key, days);
        if (!isValidDateKey(shifted)) broken.push(`${key} + ${days} -> ${shifted}`);
        if (daysBetweenDateKeys(key, shifted) !== days) {
          broken.push(`${key} + ${days} -> ${shifted} does not measure back`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("hands back a rejectable key for a year that has none", () => {
    // Walking off either end of the four-digit range has to stay total —
    // `availabilityFor` does it on purpose — but what comes back must be
    // something `isValidDateKey` refuses rather than a plausible-looking key.
    expect(isValidDateKey(addDaysToDateKey("9999-12-31", 1))).toBe(false);
    expect(isValidDateKey(addDaysToDateKey("0001-01-01", -400))).toBe(false);
    expect(isValidDateKey(formatDateKey(-1, 1, 1))).toBe(false);
    expect(isValidDateKey(formatDateKey(10_000, 1, 1))).toBe(false);
    expect(addDaysToDateKey("9999-12-31", 1)).toBe("10000-01-01");
  });

  it("converts a first-millennium key to an instant without shifting the year", () => {
    const instant = zonedTimeToInstant("0050-06-01", 12 * 60, "UTC");
    expect(dateKeyInTimeZone(instant, "UTC")).toBe("0050-06-01");
    expect(minutesInTimeZone(instant, "UTC")).toBe(12 * 60);
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
