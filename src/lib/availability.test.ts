import { describe, expect, it } from "vitest";
import {
  type BusyInterval,
  type DateOverride,
  type SlotOptions,
  type WeeklyRule,
  isSlotBookable,
  mergeWindows,
  slotsForDate,
  slotsForRange,
  windowsForDate,
} from "./availability";
import { formatTimeOfDay, zonedTimeToInstant } from "./time";

const LA = "America/Los_Angeles";

/** 2026-08-03 is a Monday. */
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
    const busy: BusyInterval[] = [
      {
        start: zonedTimeToInstant(MONDAY, 10 * 60, LA),
        end: zonedTimeToInstant(MONDAY, 11 * 60, LA),
      },
    ];
    const slots = labels(slotsForDate(MONDAY, options(), NINE_TO_FIVE, [], busy));
    expect(slots).toContain("9:30 am");
    expect(slots).not.toContain("10:00 am");
    expect(slots).not.toContain("10:30 am");
    expect(slots).toContain("11:00 am");
  });

  it("keeps buffer minutes clear around a booking", () => {
    const busy: BusyInterval[] = [
      {
        start: zonedTimeToInstant(MONDAY, 10 * 60, LA),
        end: zonedTimeToInstant(MONDAY, 10 * 60 + 30, LA),
      },
    ];
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
    const busy: BusyInterval[] = [
      {
        start: zonedTimeToInstant(MONDAY, 10 * 60, LA),
        end: zonedTimeToInstant(MONDAY, 10 * 60 + 30, LA),
      },
      {
        start: zonedTimeToInstant(MONDAY, 13 * 60, LA),
        end: zonedTimeToInstant(MONDAY, 13 * 60 + 30, LA),
      },
    ];
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
    const busy: BusyInterval[] = [
      {
        start: zonedTimeToInstant(MONDAY, 16 * 60 + 30, LA),
        end: zonedTimeToInstant(MONDAY, 17 * 60, LA),
      },
    ];
    expect(
      slotsForDate(TUESDAY, options({ dailyLimit: 1 }), NINE_TO_FIVE, [], busy).length,
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
      { start: slots[0], end: slots[0] + 30 * 60_000 },
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
