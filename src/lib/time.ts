/**
 * Timezone primitives, built on `Intl` alone.
 *
 * Booking is the one domain where "what time is it" has two right answers at
 * once: the host publishes availability in their own wall clock, the guest
 * reads it in theirs, and the only thing that survives the round trip is the
 * absolute instant. So the whole app speaks three types, and never mixes them:
 *
 *   - **instant** — epoch milliseconds. What the database stores. Unambiguous.
 *   - **date key** — "YYYY-MM-DD", a calendar day *in a named zone*. What a
 *     day column on a booking page means.
 *   - **minutes** — 0..1440, minutes past midnight *in a named zone*. What an
 *     availability rule means.
 *
 * A date key plus minutes plus a zone converts to an instant, and back. No
 * `Date` method that reads the *host machine's* zone (getHours, getDate,
 * toISOString-then-slice on a local date, …) may be used anywhere in this file
 * or its callers — the server's zone is an accident of deployment.
 */

export const MINUTES_PER_DAY = 24 * 60;

/** A calendar day in some named zone, "YYYY-MM-DD". */
export type DateKey = string;

/** 0 = Sunday … 6 = Saturday, matching `Date.prototype.getUTCDay`. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const partsCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = partsCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsCache.set(timeZone, fmt);
  }
  return fmt;
}

type WallClock = {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  second: number;
};

/** Decompose an instant into the wall-clock reading shown in `timeZone`. */
export function wallClockInTimeZone(instant: number, timeZone: string): WallClock {
  const parts = partsFormatter(timeZone).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/**
 * Offset of `timeZone` from UTC at `instant`, in milliseconds — positive east
 * of Greenwich. Derived by reading the zone's wall clock and asking how far it
 * has drifted from the same reading interpreted as UTC, which is the only way
 * to get a numeric offset out of `Intl` without parsing zone-name strings.
 */
export function timeZoneOffsetMs(instant: number, timeZone: string): number {
  const w = wallClockInTimeZone(instant, timeZone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  // `instant`'s own sub-second part isn't in `asUtc`; drop it from both sides
  // so the difference is a whole number of minutes as offsets always are.
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * Convert a wall-clock reading in `timeZone` to the instant it names.
 *
 * Two passes, because the offset we need depends on the answer we're computing.
 * Pass one guesses the offset by treating the wall time as UTC; pass two
 * re-reads the offset at the corrected instant and, if a DST boundary sits
 * between the two, corrects again.
 *
 * Ambiguity at DST boundaries is resolved, not signalled: in the repeated hour
 * of a fall-back this returns the *first* (pre-transition) occurrence, and in
 * the skipped hour of a spring-forward it returns the instant the wall clock
 * jumps to. Availability windows that straddle a transition therefore stay
 * contiguous rather than opening a hole or a duplicate — the behaviour a
 * booking page wants, and the reason this doesn't throw.
 */
export function zonedTimeToInstant(
  dateKey: DateKey,
  minutes: number,
  timeZone: string,
): number {
  const { year, month, day } = parseDateKey(dateKey);
  const dayOffset = Math.floor(minutes / MINUTES_PER_DAY);
  const withinDay = minutes - dayOffset * MINUTES_PER_DAY;
  const hour = Math.floor(withinDay / 60);
  const minute = withinDay % 60;

  const naive = Date.UTC(year, month - 1, day + dayOffset, hour, minute);
  const firstGuess = naive - timeZoneOffsetMs(naive, timeZone);
  const refined = naive - timeZoneOffsetMs(firstGuess, timeZone);
  return refined;
}

/** The calendar day `instant` falls on, as read in `timeZone`. */
export function dateKeyInTimeZone(instant: number, timeZone: string): DateKey {
  const w = wallClockInTimeZone(instant, timeZone);
  return formatDateKey(w.year, w.month, w.day);
}

/** Minutes past midnight `instant` falls on, as read in `timeZone`. */
export function minutesInTimeZone(instant: number, timeZone: string): number {
  const w = wallClockInTimeZone(instant, timeZone);
  return w.hour * 60 + w.minute;
}

export function formatDateKey(year: number, month: number, day: number): DateKey {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

export function parseDateKey(dateKey: DateKey): {
  year: number;
  month: number;
  day: number;
} {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) throw new Error(`invalid date key: ${dateKey}`);
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

export function isValidDateKey(value: string): value is DateKey {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const { year, month, day } = parseDateKey(value);
  // Round-trip through UTC to reject 2026-02-30 and friends, which `Date.UTC`
  // would silently roll forward into March.
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
}

/**
 * Shift a date key by whole days. Pure calendar arithmetic via `Date.UTC` —
 * no zone is involved, so this never gains or loses an hour to DST the way
 * adding 86400000ms to an instant would.
 */
export function addDaysToDateKey(dateKey: DateKey, days: number): DateKey {
  const { year, month, day } = parseDateKey(dateKey);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return formatDateKey(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

/** Weekday of a date key, 0 = Sunday. Zone-independent: a date key *is* a day. */
export function weekdayOfDateKey(dateKey: DateKey): Weekday {
  const { year, month, day } = parseDateKey(dateKey);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() as Weekday;
}

/** Whole days from `from` to `to`, signed. */
export function daysBetweenDateKeys(from: DateKey, to: DateKey): number {
  const a = parseDateKey(from);
  const b = parseDateKey(to);
  const ms =
    Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day);
  return Math.round(ms / 86_400_000);
}

/** Inclusive range of date keys. */
export function dateKeyRange(start: DateKey, end: DateKey): DateKey[] {
  const out: DateKey[] = [];
  const span = daysBetweenDateKeys(start, end);
  for (let i = 0; i <= span; i += 1) out.push(addDaysToDateKey(start, i));
  return out;
}

/* ── formatting ── */

/** "9:30 am" — the guest-facing slot label. */
export function formatTimeOfDay(instant: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(new Date(instant))
    .toLowerCase();
}

/** "wednesday, august 5" */
export function formatLongDate(instant: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  })
    .format(new Date(instant))
    .toLowerCase();
}

/** "aug 5, 2026 · 9:30 am pdt" — the confirmation-page stamp. */
export function formatFullStamp(instant: number, timeZone: string): string {
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(instant));
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(new Date(instant));
  return `${date} · ${time}`.toLowerCase();
}

/** "1h 30m" / "45m" — durations, never bare minute counts in copy. */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** "9:00" from minutes past midnight — the availability-editor label. */
export function formatMinutes(minutes: number): string {
  const clamped = Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(minutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Inverse of `formatMinutes`; returns null on anything unparseable. */
export function parseMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 24 || m > 59 || (h === 24 && m !== 0)) return null;
  return h * 60 + m;
}

/**
 * The guest's zone, or a safe fallback. `resolvedOptions` is available in every
 * browser the design system targets, but this is also called during SSR where
 * it would report the server's zone — callers must only use it client-side.
 */
export function guessTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Whether `timeZone` is a zone this runtime's `Intl` actually knows. */
export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** "-07:00" — the UTC offset of `timeZone` at `instant`, for zone pickers. */
export function formatOffset(instant: number, timeZone: string): string {
  const offset = timeZoneOffsetMs(instant, timeZone);
  const sign = offset < 0 ? "-" : "+";
  const total = Math.abs(Math.round(offset / 60_000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
