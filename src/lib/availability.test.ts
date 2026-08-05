import { describe, expect, it } from "vitest";
import {
  type BusyInterval,
  type DateOverride,
  type SlotOptions,
  type WeeklyRule,
  MAX_RANGE_DAYS,
  isSlotBookable,
  mergeWindows,
  slotsForDate,
  slotsForRange,
  windowsForDate,
} from "./availability";
import {
  MINUTES_PER_DAY,
  type DateKey,
  addDaysToDateKey,
  dateKeyInTimeZone,
  formatTimeOfDay,
  zonedTimeToInstant,
} from "./time";

const LA = "America/Los_Angeles";

/** 2026-08-03 is a Monday. */
const SUNDAY = "2026-08-02";
const MONDAY = "2026-08-03";
const TUESDAY = "2026-08-04";
const SATURDAY = "2026-08-08";

/** Well before any slot under test, so min-notice never bites unless asked. */
const NOW = zonedTimeToInstant("2026-08-01", 0, LA);

const NINE_TO_FIVE: WeeklyRule[] = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday: weekday as WeeklyRule["weekday"],
  startMin: 9 * 60,
  endMin: 17 * 60,
}));

function options(overrides: Partial<SlotOptions> = {}): SlotOptions {
  return {
    timeZone: LA,
    durationMin: 30,
    incrementMin: 30,
    bufferBeforeMin: 0,
    bufferAfterMin: 0,
    minNoticeMin: 0,
    maxDaysAhead: 60,
    dailyLimit: null,
    now: NOW,
    ...overrides,
  };
}

const labels = (slots: number[]) => slots.map((s) => formatTimeOfDay(s, LA));

/**
 * A busy interval shaped the way `busyBetween` actually produces them: `start`
 * and `end` are the guard span, already widened by the *booked* event type's
 * buffers, and `eventStart` is the meeting's own instant.
 *
 * Every fixture in this file used to be hand-written with `start` set to the
 * unbuffered instant, which is not a value the real code can hand the slot
 * engine. That made the buffered and unbuffered readings identical, and the
 * daily limit counting on the wrong one went unnoticed for exactly as long.
 */
function booked(
  dateKey: DateKey,
  startMin: number,
  durationMin: number,
  buffers: { before?: number; after?: number } = {},
  timeZone = LA,
): BusyInterval {
  const eventStart = zonedTimeToInstant(dateKey, startMin, timeZone);
  const eventEnd = eventStart + durationMin * 60_000;
  return {
    start: eventStart - (buffers.before ?? 0) * 60_000,
    end: eventEnd + (buffers.after ?? 0) * 60_000,
    eventStart,
  };
}

describe("mergeWindows", () => {
  it("merges overlapping and touching windows", () => {
    expect(
      mergeWindows([
        { startMin: 600, endMin: 720 },
        { startMin: 720, endMin: 840 },
      ]),
    ).toEqual([{ startMin: 600, endMin: 840 }]);

    expect(
      mergeWindows([
        { startMin: 600, endMin: 780 },
        { startMin: 700, endMin: 840 },
      ]),
    ).toEqual([{ startMin: 600, endMin: 840 }]);
  });

  it("keeps genuinely separate windows apart and sorts them", () => {
    expect(
      mergeWindows([
        { startMin: 840, endMin: 960 },
        { startMin: 540, endMin: 720 },
      ]),
    ).toEqual([
      { startMin: 540, endMin: 720 },
      { startMin: 840, endMin: 960 },
    ]);
  });

  it("drops empty and inverted windows", () => {
    expect(
      mergeWindows([
        { startMin: 600, endMin: 600 },
        { startMin: 800, endMin: 700 },
      ]),
    ).toEqual([]);
  });

  it("clamps to the day", () => {
    expect(mergeWindows([{ startMin: -60, endMin: 2000 }])).toEqual([
      { startMin: 0, endMin: 1440 },
    ]);
  });
});

describe("windowsForDate", () => {
  it("uses the weekday's recurring rules", () => {
    expect(windowsForDate(MONDAY, NINE_TO_FIVE, [])).toEqual([
      { startMin: 540, endMin: 1020 },
    ]);
  });

  it("returns nothing on a day with no rule", () => {
    expect(windowsForDate(SATURDAY, NINE_TO_FIVE, [])).toEqual([]);
  });

  it("lets a blocked override clear the day", () => {
    const overrides: DateOverride[] = [
      { date: MONDAY, blocked: true, startMin: null, endMin: null },
    ];
    expect(windowsForDate(MONDAY, NINE_TO_FIVE, overrides)).toEqual([]);
  });

  it("replaces rather than adds to the recurring rules", () => {
    const overrides: DateOverride[] = [
      { date: MONDAY, blocked: false, startMin: 14 * 60, endMin: 16 * 60 },
    ];
    expect(windowsForDate(MONDAY, NINE_TO_FIVE, overrides)).toEqual([
      { startMin: 840, endMin: 960 },
    ]);
  });

  it("can open a day that has no recurring rule at all", () => {
    const overrides: DateOverride[] = [
      { date: SATURDAY, blocked: false, startMin: 10 * 60, endMin: 12 * 60 },
    ];
    expect(windowsForDate(SATURDAY, NINE_TO_FIVE, overrides)).toEqual([
      { startMin: 600, endMin: 720 },
    ]);
  });

  it("only applies an override to its own date", () => {
    const overrides: DateOverride[] = [
      { date: MONDAY, blocked: true, startMin: null, endMin: null },
    ];
    expect(windowsForDate(TUESDAY, NINE_TO_FIVE, overrides)).toEqual([
      { startMin: 540, endMin: 1020 },
    ]);
  });
});

describe("slotsForDate", () => {
  it("walks a window at the increment and stops so the last slot fits", () => {
    const slots = slotsForDate(MONDAY, options(), NINE_TO_FIVE, [], []);
    expect(labels(slots)[0]).toBe("9:00 am");
    expect(labels(slots).at(-1)).toBe("4:30 pm");
    expect(slots).toHaveLength(16);
  });

  it("does not emit a slot that would overrun the window", () => {
    // 45-minute meeting in a 9-10 window: only 9:00 fits, 9:30 would end 10:15.
    const rules: WeeklyRule[] = [{ weekday: 1, startMin: 540, endMin: 600 }];
    const slots = slotsForDate(
      MONDAY,
      options({ durationMin: 45, incrementMin: 30 }),
      rules,
      [],
      [],
    );
    expect(labels(slots)).toEqual(["9:00 am"]);
  });

  it("returns nothing on a closed day", () => {
    expect(slotsForDate(SATURDAY, options(), NINE_TO_FIVE, [], [])).toEqual([]);
  });

  it("honours minimum notice", () => {
    // "Now" is 9:00 am Monday with 120 minutes of notice required, so the first
    // bookable slot is 11:00.
    const now = zonedTimeToInstant(MONDAY, 9 * 60, LA);
    const slots = slotsForDate(
      MONDAY,
      options({ now, minNoticeMin: 120 }),
      NINE_TO_FIVE,
      [],
      [],
    );
    expect(labels(slots)[0]).toBe("11:00 am");
  });

  it("refuses days beyond the booking horizon", () => {
    const slots = slotsForDate(MONDAY, options({ maxDaysAhead: 1 }), NINE_TO_FIVE, [], []);
    expect(slots).toEqual([]);
  });

  it("refuses days in the past", () => {
    const now = zonedTimeToInstant("2026-08-10", 0, LA);
    expect(slotsForDate(MONDAY, options({ now }), NINE_TO_FIVE, [], [])).toEqual([]);
  });

  it("removes slots that collide with a booking", () => {
    const busy = [booked(MONDAY, 10 * 60, 60)];
    const slots = labels(slotsForDate(MONDAY, options(), NINE_TO_FIVE, [], busy));
    expect(slots).toContain("9:30 am");
    expect(slots).not.toContain("10:00 am");
    expect(slots).not.toContain("10:30 am");
    expect(slots).toContain("11:00 am");
  });

  it("keeps buffer minutes clear around a booking", () => {
    const busy = [booked(MONDAY, 10 * 60, 30)];
    const slots = labels(
      slotsForDate(
        MONDAY,
        options({ bufferBeforeMin: 15, bufferAfterMin: 15 }),
        NINE_TO_FIVE,
        [],
        busy,
      ),
    );
    // 9:30-10:00 now ends inside the booking's 15-minute lead-in, and
    // 10:30-11:00 starts inside its trail-out.
    expect(slots).not.toContain("9:30 am");
    expect(slots).not.toContain("10:30 am");
    expect(slots).toContain("9:00 am");
    expect(slots).toContain("11:00 am");
  });

  it("closes the day once the daily limit is reached", () => {
    const busy = [booked(MONDAY, 10 * 60, 30), booked(MONDAY, 13 * 60, 30)];
    expect(slotsForDate(MONDAY, options({ dailyLimit: 2 }), NINE_TO_FIVE, [], busy)).toEqual(
      [],
    );
    expect(
      slotsForDate(MONDAY, options({ dailyLimit: 3 }), NINE_TO_FIVE, [], busy).length,
    ).toBeGreaterThan(0);
  });

  it("counts the daily limit per host-local day, not per UTC day", () => {
    // 5pm Monday in LA is already Tuesday in UTC; it must not count against
    // Tuesday's limit.
    const busy = [booked(MONDAY, 16 * 60 + 30, 30)];
    expect(
      slotsForDate(TUESDAY, options({ dailyLimit: 1 }), NINE_TO_FIVE, [], busy).length,
    ).toBeGreaterThan(0);
  });

  it("counts a buffered booking against the day it happens on", () => {
    // A 30-minute lead-in on a midnight meeting reaches back into the previous
    // day, and counting the guard span rather than the meeting put it there:
    // the day with two bookings on it stayed wide open, and the empty day
    // before it closed. Host open around the clock so midnight is bookable.
    const allDay: WeeklyRule[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday: weekday as WeeklyRule["weekday"],
      startMin: 0,
      endMin: MINUTES_PER_DAY,
    }));
    const busy = [
      booked(MONDAY, 0, 30, { before: 30 }),
      booked(MONDAY, 2 * 60, 30, { before: 30 }),
    ];
    const opts = options({ dailyLimit: 2, bufferBeforeMin: 30 });

    expect(slotsForDate(MONDAY, opts, allDay, [], busy)).toEqual([]);
    // …and Sunday, which has nothing on it, is not closed by the phantom.
    expect(
      slotsForDate(SUNDAY, opts, allDay, [], busy).length,
    ).toBeGreaterThan(0);
  });

  it("splits slots around a midday gap", () => {
    const rules: WeeklyRule[] = [
      { weekday: 1, startMin: 9 * 60, endMin: 11 * 60 },
      { weekday: 1, startMin: 14 * 60, endMin: 16 * 60 },
    ];
    const slots = labels(slotsForDate(MONDAY, options(), rules, [], []));
    expect(slots).toEqual([
      "9:00 am",
      "9:30 am",
      "10:00 am",
      "10:30 am",
      "2:00 pm",
      "2:30 pm",
      "3:00 pm",
      "3:30 pm",
    ]);
  });

  it("keeps the host's wall clock across a spring-forward", () => {
    // 2026-03-08 is the US spring-forward Sunday. A Sunday 9-5 rule must still
    // start at 9am local even though the day is only 23 hours long.
    const rules: WeeklyRule[] = [{ weekday: 0, startMin: 9 * 60, endMin: 17 * 60 }];
    const now = zonedTimeToInstant("2026-03-01", 0, LA);
    const slots = slotsForDate("2026-03-08", options({ now }), rules, [], []);
    expect(labels(slots)[0]).toBe("9:00 am");
    expect(labels(slots).at(-1)).toBe("4:30 pm");
  });

  it("keeps the host's wall clock across a fall-back", () => {
    const rules: WeeklyRule[] = [{ weekday: 0, startMin: 9 * 60, endMin: 17 * 60 }];
    const now = zonedTimeToInstant("2026-10-25", 0, LA);
    const slots = slotsForDate("2026-11-01", options({ now }), rules, [], []);
    expect(labels(slots)[0]).toBe("9:00 am");
    expect(labels(slots).at(-1)).toBe("4:30 pm");
    // A 25-hour day must not produce duplicate wall-clock labels.
    expect(new Set(labels(slots)).size).toBe(slots.length);
  });

  it("emits strictly increasing, unique instants", () => {
    const slots = slotsForDate(MONDAY, options({ incrementMin: 15 }), NINE_TO_FIVE, [], []);
    expect(new Set(slots).size).toBe(slots.length);
    for (let i = 1; i < slots.length; i += 1) {
      expect(slots[i]).toBeGreaterThan(slots[i - 1]);
    }
  });

  it("rejects nonsensical durations rather than looping forever", () => {
    expect(slotsForDate(MONDAY, options({ durationMin: 0 }), NINE_TO_FIVE, [], [])).toEqual(
      [],
    );
    expect(slotsForDate(MONDAY, options({ incrementMin: 0 }), NINE_TO_FIVE, [], [])).toEqual(
      [],
    );
  });
});

describe("slotsForRange", () => {
  it("covers the span inclusively and marks closed days empty", () => {
    const days = slotsForRange("2026-08-03", "2026-08-09", options(), NINE_TO_FIVE, [], []);
    expect(days).toHaveLength(7);
    expect(days.map((d) => d.date)).toEqual([
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
      "2026-08-09",
    ]);
    expect(days.filter((d) => d.slots.length > 0)).toHaveLength(5);
  });

  it("refuses a span wider than the cap instead of truncating it", () => {
    const end = addDaysToDateKey("2026-08-03", MAX_RANGE_DAYS);
    expect(() =>
      slotsForRange("2026-08-03", end, options(), NINE_TO_FIVE, [], []),
    ).toThrow(RangeError);
    // One day narrower is the widest legitimate horizon, and still works.
    expect(
      slotsForRange(
        "2026-08-03",
        addDaysToDateKey("2026-08-03", MAX_RANGE_DAYS - 1),
        options({ maxDaysAhead: MAX_RANGE_DAYS }),
        NINE_TO_FIVE,
        [],
        [],
      ),
    ).toHaveLength(MAX_RANGE_DAYS);
  });
});

/**
 * The two halves of the same rule: `slotsForDate` decides what is offered and
 * `isSlotBookable` decides what is accepted, and they agree only as long as an
 * instant reads back as the day it was generated for. Stating it as a property
 * rather than as cases is the point — the zone and date that break it are not
 * ones anyone would think to write down. Havana and Santiago spring forward at
 * midnight, so the wall time 00:00 simply doesn't happen there twice a decade;
 * the other three are here to prove the check costs ordinary zones nothing.
 */
describe("slotsForDate / isSlotBookable agree", () => {
  const zones = [
    "America/Havana",
    "America/Santiago",
    "Europe/Berlin",
    "Australia/Sydney",
    "America/Los_Angeles",
  ];

  for (const timeZone of zones) {
    it(`every slot offered in ${timeZone} is bookable`, () => {
      // Open around the clock: a 9-5 host never meets a midnight transition.
      const allDay: WeeklyRule[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        weekday: weekday as WeeklyRule["weekday"],
        startMin: 0,
        endMin: MINUTES_PER_DAY,
      }));
      // A coarse increment keeps a year in five zones cheap, and costs nothing
      // here: `isSlotBookable` re-runs the whole day per slot, and the slot
      // that breaks the invariant is always the one at 00:00, which every
      // increment emits.
      const opts = options({
        timeZone,
        incrementMin: 180,
        maxDaysAhead: 400,
        now: zonedTimeToInstant("2025-12-31", 0, timeZone),
      });

      let date = "2026-01-01";
      const offenders: string[] = [];
      for (let i = 0; i < 365; i += 1) {
        for (const start of slotsForDate(date, opts, allDay, [], [])) {
          if (dateKeyInTimeZone(start, timeZone) !== date) {
            offenders.push(`${date} emitted an instant on ${dateKeyInTimeZone(start, timeZone)}`);
          } else if (!isSlotBookable(start, opts, allDay, [], [])) {
            offenders.push(`${date} emitted an unbookable ${start}`);
          }
        }
        date = addDaysToDateKey(date, 1);
      }
      expect(offenders).toEqual([]);
    });
  }
});

describe("isSlotBookable", () => {
  it("accepts a slot the generator produced", () => {
    const slots = slotsForDate(MONDAY, options(), NINE_TO_FIVE, [], []);
    expect(isSlotBookable(slots[0], options(), NINE_TO_FIVE, [], [])).toBe(true);
  });

  it("rejects a start that is off-grid even inside the window", () => {
    const offGrid = zonedTimeToInstant(MONDAY, 9 * 60 + 7, LA);
    expect(isSlotBookable(offGrid, options(), NINE_TO_FIVE, [], [])).toBe(false);
  });

  it("rejects a slot that has since been taken", () => {
    const slots = slotsForDate(MONDAY, options(), NINE_TO_FIVE, [], []);
    const taken: BusyInterval[] = [
      { start: slots[0], end: slots[0] + 30 * 60_000, eventStart: slots[0] },
    ];
    expect(isSlotBookable(slots[0], options(), NINE_TO_FIVE, [], taken)).toBe(false);
  });

  it("rejects a slot on a day that has since been blocked", () => {
    const slots = slotsForDate(MONDAY, options(), NINE_TO_FIVE, [], []);
    const blocked: DateOverride[] = [
      { date: MONDAY, blocked: true, startMin: null, endMin: null },
    ];
    expect(isSlotBookable(slots[0], options(), NINE_TO_FIVE, blocked, [])).toBe(false);
  });
});
