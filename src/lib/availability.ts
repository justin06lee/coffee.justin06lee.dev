/**
 * Turning availability rules into bookable slots.
 *
 * Pure functions over plain data — no database, no clock of its own. Every
 * time-dependent input (`now`, the busy list) is passed in, so the whole slot
 * engine is testable without stubbing anything, which is what the tests in
 * `availability.test.ts` rely on.
 */

import {
  MINUTES_PER_DAY,
  type DateKey,
  type Weekday,
  addDaysToDateKey,
  dateKeyInTimeZone,
  daysBetweenDateKeys,
  weekdayOfDateKey,
  zonedTimeToInstant,
} from "./time";

/** A contiguous open window on some day, in host-local minutes past midnight. */
export type AvailabilityWindow = {
  startMin: number;
  endMin: number;
};

/** A recurring weekly opening. */
export type WeeklyRule = {
  weekday: Weekday;
  startMin: number;
  endMin: number;
};

/**
 * A one-day exception. `blocked` clears the day outright; otherwise the
 * override's windows *replace* that weekday's recurring rules rather than
 * adding to them — "on this day I'm only free 2-4" is the thing people
 * actually mean, and additive overrides can't express it.
 */
export type DateOverride = {
  date: DateKey;
  blocked: boolean;
  startMin: number | null;
  endMin: number | null;
};

/** An occupied stretch of absolute time, buffers already applied. */
export type BusyInterval = {
  start: number;
  end: number;
};

export type SlotOptions = {
  /** The host's zone. Rules and overrides are read in it. */
  timeZone: string;
  /** Meeting length in minutes. */
  durationMin: number;
  /** Spacing between candidate starts — 15 gives :00 :15 :30 :45. */
  incrementMin: number;
  /** Dead time kept clear before a meeting. */
  bufferBeforeMin: number;
  /** Dead time kept clear after a meeting. */
  bufferAfterMin: number;
  /** How far ahead a guest must book, in minutes. */
  minNoticeMin: number;
  /** How far into the future the calendar opens, in days. */
  maxDaysAhead: number;
  /** Cap on confirmed bookings per host-local day; null for no cap. */
  dailyLimit: number | null;
  /** Current instant. Injected so slot generation is deterministic in tests. */
  now: number;
};

/** Normalize and merge overlapping windows so slot walking sees clean input. */
export function mergeWindows(windows: AvailabilityWindow[]): AvailabilityWindow[] {
  const clean = windows
    .map((w) => ({
      startMin: Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(w.startMin))),
      endMin: Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(w.endMin))),
    }))
    .filter((w) => w.endMin > w.startMin)
    .sort((a, b) => a.startMin - b.startMin);

  const merged: AvailabilityWindow[] = [];
  for (const w of clean) {
    const last = merged[merged.length - 1];
    // Touching windows (10-12 and 12-14) merge too: the boundary isn't a break
    // in availability, and leaving them split would drop a slot that straddles
    // noon even though the host is free straight through.
    if (last && w.startMin <= last.endMin) {
      last.endMin = Math.max(last.endMin, w.endMin);
    } else {
      merged.push({ ...w });
    }
  }
  return merged;
}

/** The open windows on `dateKey`, overrides taking precedence over weekly rules. */
export function windowsForDate(
  dateKey: DateKey,
  rules: WeeklyRule[],
  overrides: DateOverride[],
): AvailabilityWindow[] {
  const forDay = overrides.filter((o) => o.date === dateKey);
  if (forDay.length > 0) {
    if (forDay.some((o) => o.blocked)) return [];
    return mergeWindows(
      forDay
        .filter((o) => o.startMin !== null && o.endMin !== null)
        .map((o) => ({ startMin: o.startMin as number, endMin: o.endMin as number })),
    );
  }

  const weekday = weekdayOfDateKey(dateKey);
  return mergeWindows(
    rules
      .filter((r) => r.weekday === weekday)
      .map((r) => ({ startMin: r.startMin, endMin: r.endMin })),
  );
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Bookable start instants on one host-local day.
 *
 * Candidates are walked in host-local minutes and only then converted to
 * instants, so a window that crosses a DST boundary still yields slots on the
 * host's wall clock — 9am stays 9am to the host on both sides of the change,
 * which is the whole point of storing rules as minutes rather than offsets.
 */
export function slotsForDate(
  dateKey: DateKey,
  options: SlotOptions,
  rules: WeeklyRule[],
  overrides: DateOverride[],
  busy: BusyInterval[],
): number[] {
  const {
    timeZone,
    durationMin,
    incrementMin,
    bufferBeforeMin,
    bufferAfterMin,
    minNoticeMin,
    maxDaysAhead,
    dailyLimit,
    now,
  } = options;

  if (durationMin <= 0 || incrementMin <= 0) return [];

  // Bound the day against the booking horizon before doing any work.
  const today = dateKeyInTimeZone(now, timeZone);
  const daysOut = daysBetweenDateKeys(today, dateKey);
  if (daysOut < 0 || daysOut > maxDaysAhead) return [];

  const windows = windowsForDate(dateKey, rules, overrides);
  if (windows.length === 0) return [];

  if (dailyLimit !== null && countBookingsOnDate(dateKey, timeZone, busy) >= dailyLimit) {
    return [];
  }

  const earliest = now + minNoticeMin * 60_000;
  const slots: number[] = [];

  for (const window of windows) {
    for (
      let startMin = window.startMin;
      startMin + durationMin <= window.endMin;
      startMin += incrementMin
    ) {
      const start = zonedTimeToInstant(dateKey, startMin, timeZone);
      const end = start + durationMin * 60_000;

      if (start < earliest) continue;

      // The guarded span includes this event's own buffers; the busy intervals
      // arrive with the *booked* event's buffers already baked in. Both sides
      // apply, so a 15-minute buffer either side really does keep 15 minutes
      // clear regardless of which meeting was booked first.
      const guardStart = start - bufferBeforeMin * 60_000;
      const guardEnd = end + bufferAfterMin * 60_000;
      if (busy.some((b) => overlaps(guardStart, guardEnd, b.start, b.end))) continue;

      slots.push(start);
    }
  }

  // Windows are merged and walked in order, but a day can still produce
  // duplicates when two windows are separated by less than one increment.
  return [...new Set(slots)].sort((a, b) => a - b);
}

function countBookingsOnDate(
  dateKey: DateKey,
  timeZone: string,
  busy: BusyInterval[],
): number {
  return busy.filter((b) => dateKeyInTimeZone(b.start, timeZone) === dateKey).length;
}

export type DayAvailability = {
  date: DateKey;
  slots: number[];
};

/** `slotsForDate` across an inclusive span, for the month/strip views. */
export function slotsForRange(
  start: DateKey,
  end: DateKey,
  options: SlotOptions,
  rules: WeeklyRule[],
  overrides: DateOverride[],
  busy: BusyInterval[],
): DayAvailability[] {
  const span = daysBetweenDateKeys(start, end);
  const out: DayAvailability[] = [];
  for (let i = 0; i <= span; i += 1) {
    const date = addDaysToDateKey(start, i);
    out.push({ date, slots: slotsForDate(date, options, rules, overrides, busy) });
  }
  return out;
}

/**
 * Whether a specific start is still bookable — the check the booking action
 * runs at commit time. Re-deriving it from the same rules rather than trusting
 * the slot list the client posted back is what stops a stale page from
 * double-booking a slot someone else took while it sat open.
 */
export function isSlotBookable(
  start: number,
  options: SlotOptions,
  rules: WeeklyRule[],
  overrides: DateOverride[],
  busy: BusyInterval[],
): boolean {
  const dateKey = dateKeyInTimeZone(start, options.timeZone);
  return slotsForDate(dateKey, options, rules, overrides, busy).includes(start);
}

/** Human-readable weekday names, index-aligned with `Weekday`. */
export const WEEKDAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export const WEEKDAY_SHORT = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
