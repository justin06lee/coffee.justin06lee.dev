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
  const asUtc =
    utcMsFromDateParts(w.year, w.month, w.day) +
    w.hour * 3_600_000 +
    w.minute * 60_000 +
    w.second * 1_000;
  // `instant`'s own sub-second part isn't in `asUtc`; drop it from both sides
  // so the difference is a whole number of minutes as offsets always are.
  return asUtc - Math.floor(instant / 1000) * 1000;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Convert a wall-clock reading in `timeZone` to the instant it names.
 *
 * A wall time can't be converted without an offset, and the offset can't be
 * read without an instant, so the offset is bracketed instead of guessed: read
 * it a day either side of the naive reading. tzdb never changes a zone's offset
 * twice inside 48 hours, so those two readings are the only offsets that can
 * apply here, and a day is comfortably wider than the largest offset in use
 * (+14:00) so every candidate instant falls inside the bracket. When they
 * agree — every wall time except the two days a year a zone shifts — the
 * conversion is one subtraction and we're done.
 *
 * When they disagree a transition is nearby and the wall time has zero, one or
 * two instants. Ambiguity is resolved, not signalled, because a booking page
 * wants a window straddling a transition to stay contiguous rather than open a
 * hole or a duplicate:
 *
 *   - **repeated (fall-back)** — both candidates round-trip; this returns the
 *     *first*, pre-transition occurrence, so the earlier of the two.
 *   - **skipped (spring-forward)** — neither candidate round-trips; this
 *     returns the instant the wall clock jumped to, which is the first instant
 *     that exists at or after the time asked for.
 *
 * Snapping a skipped time to the transition rather than sliding it on by the
 * width of the gap is what keeps the answer inside the window the caller was
 * asking about: a host free 01:00-03:00 on a spring-forward day gets slots up
 * to the jump and no further, instead of gaining 03:15 out of nowhere. It costs
 * duplicates — every skipped time collapses onto the same instant — but a day
 * has more wall-clock readings than instants on a day like that, so some
 * collision is forced; what matters is that walking a day never goes backwards.
 *
 * The result reads back on the requested `dateKey` — never the day before, the
 * bug this replaced — with one exception no instant could satisfy: a gap that
 * runs past local midnight, where the next real instant is on the following day
 * by definition. America/Nuuk and America/Scoresbysund spring forward at 23:00
 * and are the only zones still doing it; Pacific/Apia skipped 2011-12-30 whole.
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

  const naive =
    utcMsFromDateParts(year, month, day + dayOffset) +
    hour * 3_600_000 +
    minute * 60_000;

  const offsetBefore = timeZoneOffsetMs(naive - DAY_MS, timeZone);
  const offsetAfter = timeZoneOffsetMs(naive + DAY_MS, timeZone);
  const asBefore = naive - offsetBefore;
  if (offsetBefore === offsetAfter) return asBefore;

  // Preferring the pre-transition reading whenever it survives the round trip
  // does double duty: it is simply the right answer for a wall time that falls
  // before the transition, and in a fall-back repeat — where both readings
  // survive — it is the earlier of the two, which is the documented choice.
  if (timeZoneOffsetMs(asBefore, timeZone) === offsetBefore) return asBefore;
  const asAfter = naive - offsetAfter;
  if (timeZoneOffsetMs(asAfter, timeZone) === offsetAfter) return asAfter;

  // Neither survives, so this wall time never happened. The gap it fell into is
  // bracketed by the two candidates — `asAfter` sits before the transition and
  // `asBefore` at or after it — so the jump itself is findable between them.
  return transitionBetween(asAfter, asBefore, offsetAfter, timeZone);
}

/**
 * The instant a spring-forward jump happened, given a bracket around it.
 * Bisected, because `Intl` will answer "what is the offset at this instant" and
 * nothing else — there is no way to ask when the offset last changed. The
 * bracket is the width of the gap and transitions land on a whole minute, so
 * this is a bounded handful of reads, and it only runs for a wall time that
 * doesn't exist: never on the path a normal slot takes.
 */
function transitionBetween(
  before: number,
  after: number,
  offsetAfter: number,
  timeZone: string,
): number {
  let lo = before;
  let hi = after;
  while (hi - lo > 60_000) {
    // Step in whole minutes from `lo` so the answer lands on the same minute
    // grid the transition does, and never below one minute so this terminates
    // even if some historical offset makes the bracket a ragged length.
    const step = Math.max(60_000, Math.floor((hi - lo) / 120_000) * 60_000);
    const mid = lo + step;
    if (timeZoneOffsetMs(mid, timeZone) === offsetAfter) hi = mid;
    else lo = mid;
  }
  return hi;
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

/**
 * Midnight UTC on a calendar date, with `Date.UTC`'s two-digit-year rule undone.
 * `Date.UTC(50, …)` means 1950, so a year-50 date key would silently become a
 * 20th-century one; `setUTCFullYear` is the only way to name years 0-99
 * literally. Setting year, month and day in one call matters — rolling the day
 * over first and correcting the year afterwards would resolve 0000-02-29
 * against 1900, which isn't a leap year, and lose the day.
 */
function utcMsFromDateParts(year: number, month: number, day: number): number {
  if (year >= 0 && year < 100) {
    const d = new Date(0);
    d.setUTCFullYear(year, month - 1, day);
    return d.getTime();
  }
  return Date.UTC(year, month - 1, day);
}

export function formatDateKey(year: number, month: number, day: number): DateKey {
  // The year is padded for the same reason the month and day are: `parseDateKey`
  // and every caller's validation want exactly four digits, so year 100 has to
  // come back as "0100" or a valid key in stops yielding a valid key out.
  //
  // A year outside 0-9999 has no key at all, and this stays total rather than
  // throwing for it: `availabilityFor` walks deliberately off the end of the
  // calendar and leans on `isValidDateKey` rejecting what comes back, which an
  // exception would turn into a 500 on a public page. Leaving such a year
  // unpadded is what keeps it rejectable — "10000-01-01" and "-1-11-28" both
  // fail the key pattern, where a padded "00-1-11-28" reads like a near miss.
  const inRange = Number.isInteger(year) && year >= 0 && year <= 9999;
  const yyyy = inRange ? String(year).padStart(4, "0") : String(year);
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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
  const utc = new Date(utcMsFromDateParts(year, month, day));
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
  const shifted = new Date(utcMsFromDateParts(year, month, day + days));
  return formatDateKey(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

/** Weekday of a date key, 0 = Sunday. Zone-independent: a date key *is* a day. */
export function weekdayOfDateKey(dateKey: DateKey): Weekday {
  const { year, month, day } = parseDateKey(dateKey);
  return new Date(utcMsFromDateParts(year, month, day)).getUTCDay() as Weekday;
}

/** Whole days from `from` to `to`, signed. */
export function daysBetweenDateKeys(from: DateKey, to: DateKey): number {
  const a = parseDateKey(from);
  const b = parseDateKey(to);
  const ms =
    utcMsFromDateParts(b.year, b.month, b.day) - utcMsFromDateParts(a.year, a.month, a.day);
  return Math.round(ms / DAY_MS);
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
