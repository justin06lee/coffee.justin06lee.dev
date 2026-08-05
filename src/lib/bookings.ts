import "server-only";
import type { InStatement, Row } from "@libsql/client";
import { db, initDb, type DbBooking } from "./db";
import {
  type BusyInterval,
  type SlotOptions,
  MAX_RANGE_DAYS,
  isSlotBookable,
  slotsForRange,
  type DayAvailability,
} from "./availability";
import type { EventType } from "./event-types";
import {
  eventTypeByIdStatement,
  eventTypesFromRows,
  eventTypesStatement,
} from "./event-types";
import {
  overridesFromRows,
  overridesStatement,
  rulesFromRows,
  rulesStatement,
  type StoredOverride,
  type StoredRule,
} from "./schedule";
import { settingsFromRows, settingsStatement, type Settings } from "./settings";
import {
  type DateKey,
  addDaysToDateKey,
  dateKeyInTimeZone,
  daysBetweenDateKeys,
  isValidDateKey,
  isValidTimeZone,
} from "./time";

export type Booking = {
  id: string;
  eventTypeId: string;
  startAt: number;
  endAt: number;
  hostDate: DateKey;
  guestName: string;
  guestEmail: string;
  guestTimeZone: string;
  notes: string | null;
  status: "confirmed" | "cancelled";
  cancelToken: string;
  cancelledAt: number | null;
  cancelReason: string | null;
  createdAt: number;
};

function toBooking(row: DbBooking): Booking {
  return {
    id: row.id,
    eventTypeId: row.event_type_id,
    startAt: row.start_at,
    endAt: row.end_at,
    hostDate: row.host_date,
    guestName: row.guest_name,
    guestEmail: row.guest_email,
    guestTimeZone: row.guest_timezone,
    notes: row.notes,
    status: row.status === "cancelled" ? "cancelled" : "confirmed",
    cancelToken: row.cancel_token,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    createdAt: row.created_at,
  };
}

/**
 * Reads are split into a statement builder and a mapper so a page-level loader
 * can put them in a `db.batch` alongside its other reads — one HTTP round trip
 * for the whole page — without copying the SQL and letting the two drift apart.
 * The mappers stay pure: no `db`, no clock, so they work on rows from anywhere.
 */

/**
 * Widen every busy query by a day either side so a booking that starts before
 * the window but whose trailing buffer reaches into it is still caught.
 */
const BUSY_PAD_MS = 24 * 60 * 60_000;

/**
 * Confirmed bookings overlapping a window, already padded with the buffers of
 * the event type each one belongs to.
 *
 * The padding happens here rather than in the slot engine because it depends
 * on the *booked* meeting's type, not the one being booked — a 15-minute
 * buffer on a code review has to keep the following coffee slot clear even
 * though coffee itself declares no buffer.
 */
export function busyStatement(from: number, to: number): InStatement {
  return {
    sql: `SELECT b.start_at, b.end_at,
                 e.buffer_before_min AS bb, e.buffer_after_min AS ba
          FROM coffee_bookings b
          LEFT JOIN coffee_event_types e ON e.id = b.event_type_id
          WHERE b.status = 'confirmed' AND b.end_at > ? AND b.start_at < ?`,
    args: [from - BUSY_PAD_MS, to + BUSY_PAD_MS],
  };
}

type DbBusyRow = {
  start_at: number;
  end_at: number;
  bb: number | null;
  ba: number | null;
};

export function busyFromRows(rows: Row[]): BusyInterval[] {
  return (rows as unknown as DbBusyRow[]).map((r) => ({
    start: r.start_at - (r.bb ?? 0) * 60_000,
    end: r.end_at + (r.ba ?? 0) * 60_000,
    // The unpadded instant travels alongside the guard span because the daily
    // limit counts meetings, and a meeting is where it starts — not where its
    // lead-in buffer starts, which can be the day before.
    eventStart: r.start_at,
  }));
}

/** The standalone read, for callers with nothing else to batch it with. */
export async function busyBetween(from: number, to: number): Promise<BusyInterval[]> {
  await initDb();
  const result = await db.execute(busyStatement(from, to));
  return busyFromRows(result.rows);
}

/** The slot-engine options implied by an event type plus host settings. */
export function slotOptionsFor(
  eventType: EventType,
  settings: Settings,
  now: number,
): SlotOptions {
  return {
    timeZone: settings.timeZone,
    durationMin: eventType.durationMin,
    incrementMin: eventType.incrementMin,
    bufferBeforeMin: eventType.bufferBeforeMin,
    bufferAfterMin: eventType.bufferAfterMin,
    minNoticeMin: eventType.minNoticeMin,
    maxDaysAhead: eventType.maxDaysAhead,
    dailyLimit: eventType.dailyLimit,
    now,
  };
}

/** Everything the booking page needs for a span of days, in one round trip. */
export async function availabilityFor(
  eventType: EventType,
  from: DateKey,
  to: DateKey,
  now = Date.now(),
): Promise<{ days: DayAvailability[]; settings: Settings }> {
  await initDb();

  // Both keys arrive from the booking page's URL, so neither the shape nor the
  // width of the span is trustworthy — and a well-formed key is no safer than a
  // malformed one. `"9999-12-31"` is both problems at once: its exclusive end is
  // `"10000-01-01"`, which is not a date key at all and becomes the NaN that
  // libsql refuses as a bind argument, and the span in front of it is millions
  // of days. Decided before the batch goes out, because the answer to a bogus
  // span is an empty calendar, not a query.
  const spanEndKey = isValidDateKey(to) ? addDaysToDateKey(to, 1) : "";
  const span =
    isValidDateKey(from) && isValidDateKey(to) ? daysBetweenDateKeys(from, to) : -1;
  const usable =
    isValidDateKey(spanEndKey) && span >= 0 && span + 1 <= MAX_RANGE_DAYS;

  // The busy window is the span itself plus the horizon needed by buffers. It
  // comes from the DateKey arguments alone, so it doesn't have to wait on
  // settings — which makes all four reads independent, and one batch.
  //
  // UTC midnights rather than the host's, which is safe rather than merely
  // convenient: `busyStatement` pads a day either side, and the widest zone
  // offset (14h) plus the largest buffer (4h, clamped in event-types.ts) is
  // comfortably inside that. An unusable span still goes out as a degenerate
  // window so `settings` — which the caller needs either way — comes back in
  // the same trip.
  const spanStart = usable ? new Date(`${from}T00:00:00Z`).getTime() : 0;
  const spanEnd = usable ? new Date(`${spanEndKey}T00:00:00Z`).getTime() : 0;

  const [settingsResult, rulesResult, overridesResult, busyResult] = await db.batch([
    settingsStatement,
    rulesStatement,
    overridesStatement(),
    busyStatement(spanStart, spanEnd),
  ]);

  const settings = settingsFromRows(settingsResult.rows);
  if (!usable) return { days: [], settings };
  // A closed calendar throws away the other three result sets, which is still
  // strictly cheaper than the round trip it would take to learn that first.
  if (!settings.bookingsOpen) return { days: [], settings };

  const options = slotOptionsFor(eventType, settings, now);

  return {
    days: slotsForRange(
      from,
      to,
      options,
      rulesFromRows(rulesResult.rows),
      overridesFromRows(overridesResult.rows),
      busyFromRows(busyResult.rows),
    ),
    settings,
  };
}

/** Widest busy window any event type can need: maxDaysAhead is capped at 365. */
export const MAX_HORIZON_DAYS = 366;

/**
 * Busy intervals covering the whole horizon, for a page that batches before it
 * knows the event type's maxDaysAhead. Over-fetching is safe for the same
 * reason the superset window in `createBooking` is — see the comment there.
 */
export function horizonBusyStatement(now: number): InStatement {
  return busyStatement(now, now + MAX_HORIZON_DAYS * 24 * 60 * 60_000);
}

/**
 * Every bookable start over an event type's horizon, flattened — the shape
 * `/[slug]` renders. Pure, so a page can compute it from one batch's rows.
 */
export function horizonSlots(
  eventType: EventType,
  settings: Settings,
  rules: StoredRule[],
  overrides: StoredOverride[],
  busy: BusyInterval[],
  now: number,
): number[] {
  const today = dateKeyInTimeZone(now, settings.timeZone);
  return slotsForRange(
    today,
    addDaysToDateKey(today, eventType.maxDaysAhead),
    slotOptionsFor(eventType, settings, now),
    rules,
    overrides,
    busy,
  ).flatMap((d) => d.slots);
}

export type BookingResult =
  | { ok: true; booking: Booking }
  | { ok: false; reason: string };

export type BookingInput = {
  eventTypeId: string;
  startAt: number;
  guestName: string;
  guestEmail: string;
  guestTimeZone: string;
  notes: string | null;
};

/**
 * The longest meeting the admin form can define is 8 hours; a day is the round
 * number safely above it, and what the busy window is widened to so it can be
 * built before the event type's duration is known.
 */
const MAX_MEETING_MS = 24 * 60 * 60_000;

/**
 * Extra reach on the near side of the busy window, so it provably contains the
 * whole host-local day the slot sits on.
 *
 * The daily limit is counted over that day, and a day is not always 24 hours:
 * on a fall-back it is 25. A window measured from the slot alone therefore
 * misses same-day bookings when the slot sits near the far end of a long day —
 * the count comes up short, and posting a slot directly walks past the limit.
 * `busyStatement` already pads a day either side; two more hours covers the
 * longest transition any zone applies, with room for the half-hour ones.
 */
const DAY_SLACK_MS = 2 * 60 * 60_000;

/**
 * Commit a booking, re-deriving availability from the rules rather than
 * trusting the slot the client posted.
 *
 * Two layers guard the same invariant. The availability re-check catches a
 * stale page — someone who loaded the picker an hour ago and submitted a slot
 * that has since been taken or blocked. It cannot catch two guests who pass it
 * concurrently and both reach the insert, because by then the read it decided
 * on is already old; the conditional insert catches that one, by asking the
 * same question inside the write itself. The loser of either gets "already
 * taken" rather than a 500.
 */
export async function createBooking(
  input: BookingInput,
  now = Date.now(),
): Promise<BookingResult> {
  await initDb();

  // All five reads go out together, which means the busy window has to be
  // chosen before the duration is known. It asks for a deliberate superset:
  // `busyStatement` pads ±24h, so this spans [startAt - 24h, startAt + 48h],
  // which contains the true [startAt - 24h, startAt + duration + 24h] for any
  // duration up to a day. The extra intervals change nothing downstream —
  // `isSlotBookable` only asks whether an interval overlaps the guarded span,
  // and ones outside it don't; the daily-limit count only keeps intervals
  // whose start falls on the slot's own date, and the ±24h pad already spanned
  // that whole host-local day, so widening the far end only admits intervals
  // starting on later dates, which never match.
  const [typeResult, settingsResult, rulesResult, overridesResult, busyResult] =
    await db.batch([
      eventTypeByIdStatement(input.eventTypeId),
      settingsStatement,
      rulesStatement,
      overridesStatement(),
      busyStatement(input.startAt - DAY_SLACK_MS, input.startAt + MAX_MEETING_MS),
    ]);

  const eventType = eventTypesFromRows(typeResult.rows)[0] ?? null;
  if (!eventType || !eventType.active) {
    return { ok: false, reason: "that meeting type isn't available anymore." };
  }

  const settings = settingsFromRows(settingsResult.rows);
  if (!settings.bookingsOpen) {
    return { ok: false, reason: settings.closedMessage };
  }

  const guestTimeZone = isValidTimeZone(input.guestTimeZone)
    ? input.guestTimeZone
    : settings.timeZone;

  const rules = rulesFromRows(rulesResult.rows);
  const overrides = overridesFromRows(overridesResult.rows);
  const busy = busyFromRows(busyResult.rows);
  const options = slotOptionsFor(eventType, settings, now);
  const endAt = input.startAt + eventType.durationMin * 60_000;
  const hostDate = dateKeyInTimeZone(input.startAt, settings.timeZone);

  if (!isSlotBookable(input.startAt, options, rules, overrides, busy)) {
    return { ok: false, reason: "that slot just went away. pick another one." };
  }

  const booking: DbBooking = {
    id: crypto.randomUUID(),
    event_type_id: eventType.id,
    start_at: input.startAt,
    end_at: endAt,
    host_date: hostDate,
    guest_name: input.guestName,
    guest_email: input.guestEmail,
    guest_timezone: guestTimeZone,
    notes: input.notes,
    status: "confirmed",
    cancel_token: crypto.randomUUID(),
    cancelled_at: null,
    cancel_reason: null,
    created_at: now,
    updated_at: now,
  };

  try {
    // `INSERT ... SELECT ... WHERE NOT EXISTS` is one statement, so SQLite
    // evaluates the overlap test and the write under the same lock — the read
    // cannot go stale between them the way the availability check above can.
    // The unique index alone was never enough: it is on `start_at`, so it only
    // ever caught two guests picking the *identical* instant, and a 45-minute
    // 9:00 alongside a 30-minute 9:30 sailed past it into two overlapping
    // confirmed rows. Raw spans, not buffered ones: this is the double-booking
    // backstop, and buffers are a scheduling preference the check above owns.
    const result = await db.execute({
      sql: `INSERT INTO coffee_bookings
              (id, event_type_id, start_at, end_at, host_date, guest_name,
               guest_email, guest_timezone, notes, status, cancel_token,
               cancelled_at, cancel_reason, created_at, updated_at)
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, NULL, NULL, ?, ?
            WHERE NOT EXISTS (
              SELECT 1 FROM coffee_bookings
              WHERE status = 'confirmed' AND start_at < ? AND end_at > ?
            )`,
      args: [
        booking.id,
        booking.event_type_id,
        booking.start_at,
        booking.end_at,
        booking.host_date,
        booking.guest_name,
        booking.guest_email,
        booking.guest_timezone,
        booking.notes,
        booking.cancel_token,
        booking.created_at,
        booking.updated_at,
        booking.end_at,
        booking.start_at,
      ],
    });
    if (result.rowsAffected === 0) {
      return { ok: false, reason: "someone just took that slot. pick another one." };
    }
  } catch (error) {
    // Kept as a second layer. The guard above covers overlap, but the same
    // race can also trip `idx_coffee_bookings_slot` first, and either way the
    // loser deserves the same answer rather than a 500.
    if (isUniqueViolation(error)) {
      return { ok: false, reason: "someone just took that slot. pick another one." };
    }
    throw error;
  }

  return { ok: true, booking: toBooking(booking) };
}

/**
 * libsql surfaces constraint failures as a message, not a typed error, so this
 * matches on the SQLite wording. Kept narrow — a false positive here would
 * report "slot taken" for an unrelated failure.
 */
function isUniqueViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed/i.test(message);
}

export async function getBooking(id: string): Promise<Booking | null> {
  await initDb();
  const result = await db.execute({
    sql: "SELECT * FROM coffee_bookings WHERE id = ?",
    args: [id],
  });
  const row = (result.rows as unknown as DbBooking[])[0];
  return row ? toBooking(row) : null;
}

export function bookingByCancelTokenStatement(token: string): InStatement {
  return { sql: "SELECT * FROM coffee_bookings WHERE cancel_token = ?", args: [token] };
}

export async function getBookingByCancelToken(token: string): Promise<Booking | null> {
  await initDb();
  const result = await db.execute(bookingByCancelTokenStatement(token));
  const row = (result.rows as unknown as DbBooking[])[0];
  return row ? toBooking(row) : null;
}

export async function cancelBooking(
  id: string,
  reason: string | null,
  now = Date.now(),
): Promise<void> {
  await initDb();
  await db.execute({
    sql: `UPDATE coffee_bookings
          SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ?
          WHERE id = ? AND status = 'confirmed'`,
    args: [now, reason, now, id],
  });
}

export type CancelOutcome = "cancelled" | "not-found" | "past";

/**
 * Cancel by token, and say which of the three things happened, in one round
 * trip — the guest-facing cancel form needs the distinction to word its reply.
 *
 * The write is attempted first and the state read back after it. Both ride in
 * one transaction, so the SELECT observes the UPDATE: nothing can slip between
 * looking the booking up and acting on it.
 */
export async function cancelByCancelToken(
  token: string,
  reason: string | null,
  now = Date.now(),
): Promise<CancelOutcome> {
  await initDb();
  const [, after] = await db.batch(
    [
      {
        sql: `UPDATE coffee_bookings
              SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ?
              WHERE cancel_token = ? AND status = 'confirmed' AND start_at >= ?`,
        args: [now, reason, now, token, now],
      },
      {
        sql: "SELECT status, start_at FROM coffee_bookings WHERE cancel_token = ?",
        args: [token],
      },
    ],
    "write",
  );

  const row = (after.rows as unknown as { status: string }[])[0];
  if (!row) return "not-found";
  // One answer for "we just cancelled it" and "it was already cancelled": the
  // guest is told the same thing either way, and can't tell them apart anyway.
  if (row.status === "cancelled") return "cancelled";
  // Still confirmed, and the row exists — so the token matched and `status =
  // 'confirmed'` matched. `start_at >= ?` is the only clause left that can have
  // held the UPDATE back, which means the meeting has already happened.
  return "past";
}

export type BookingWithType = Booking & { eventType: EventType | null };

export type BookingsQuery = {
  status?: "confirmed" | "cancelled";
  from?: number;
  to?: number;
  limit?: number;
  order?: "asc" | "desc";
};

/**
 * `order` decides which end of the window the LIMIT keeps, not just how the
 * rows are arranged. Looking backwards at a busy fortnight with `asc` returned
 * the *oldest* rows and silently dropped the most recent ones — the opposite of
 * what a "what just happened" list means. Callers reading history want `desc`.
 */
export function bookingsStatement(
  { status, from, to, limit = 200, order = "asc" }: BookingsQuery = {},
): InStatement {
  const clauses: string[] = [];
  const args: (string | number)[] = [];
  if (status) {
    clauses.push("b.status = ?");
    args.push(status);
  }
  if (from !== undefined) {
    clauses.push("b.start_at >= ?");
    args.push(from);
  }
  if (to !== undefined) {
    clauses.push("b.start_at < ?");
    args.push(to);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  // Interpolated because SQLite cannot parameterize a sort direction; the union
  // type is the allowlist, and this re-narrows it so a widened type can't leak
  // arbitrary SQL in here later.
  const direction = order === "desc" ? "DESC" : "ASC";

  return {
    sql: `SELECT b.* FROM coffee_bookings b ${where}
          ORDER BY b.start_at ${direction} LIMIT ?`,
    args: [...args, limit],
  };
}

export function bookingsFromRows(rows: Row[]): Booking[] {
  return (rows as unknown as DbBooking[]).map(toBooking);
}

/**
 * The admin list, with each booking's type attached.
 *
 * The types come back as one extra statement in the same batch rather than a
 * lookup per distinct id: there are a handful of them, so fetching the lot and
 * joining in memory is cheaper than the N queries it replaces, and it stays
 * one round trip however many types the page spans. Inactive types are
 * included because a booking can legitimately point at an archived one, and
 * the row still has to render its title.
 */
export async function listBookings(
  opts: BookingsQuery = {},
): Promise<BookingWithType[]> {
  await initDb();
  const [bookingsResult, typesResult] = await db.batch([
    bookingsStatement(opts),
    eventTypesStatement({ includeInactive: true }),
  ]);

  const types = new Map(eventTypesFromRows(typesResult.rows).map((t) => [t.id, t]));

  return bookingsFromRows(bookingsResult.rows).map((b) => ({
    ...b,
    eventType: types.get(b.eventTypeId) ?? null,
  }));
}

/** Counts for the admin dashboard tiles. */
export type BookingStats = {
  upcoming: number;
  thisWeek: number;
  cancelled: number;
  total: number;
};

export function bookingStatsStatement(now: number): InStatement {
  const weekOut = now + 7 * 24 * 60 * 60_000;
  return {
    sql: `SELECT
            SUM(CASE WHEN status = 'confirmed' AND start_at >= ? THEN 1 ELSE 0 END) AS upcoming,
            SUM(CASE WHEN status = 'confirmed' AND start_at >= ? AND start_at < ? THEN 1 ELSE 0 END) AS this_week,
            SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
            COUNT(*) AS total
          FROM coffee_bookings`,
    args: [now, now, weekOut],
  };
}

export function bookingStatsFromRows(rows: Row[]): BookingStats {
  // An empty table still returns a row, but SUM over no rows is NULL.
  const row = rows[0] as unknown as
    | {
        upcoming: number | null;
        this_week: number | null;
        cancelled: number | null;
        total: number | null;
      }
    | undefined;
  return {
    upcoming: Number(row?.upcoming ?? 0),
    thisWeek: Number(row?.this_week ?? 0),
    cancelled: Number(row?.cancelled ?? 0),
    total: Number(row?.total ?? 0),
  };
}

export async function bookingStats(now = Date.now()): Promise<BookingStats> {
  await initDb();
  const result = await db.execute(bookingStatsStatement(now));
  return bookingStatsFromRows(result.rows);
}
