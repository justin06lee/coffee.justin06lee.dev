import "server-only";
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
import { getEventType } from "./event-types";
import { listOverrides, listRules } from "./schedule";
import { getSettings, type Settings } from "./settings";
import {
  type DateKey,
  addDaysToDateKey,
  dateKeyInTimeZone,
  daysBetweenDateKeys,
  isValidDateKey,
  isValidTimeZone,
  zonedTimeToInstant,
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
 * Confirmed bookings overlapping a window, already padded with the buffers of
 * the event type each one belongs to.
 *
 * The padding happens here rather than in the slot engine because it depends
 * on the *booked* meeting's type, not the one being booked — a 15-minute
 * buffer on a code review has to keep the following coffee slot clear even
 * though coffee itself declares no buffer.
 */
export async function busyBetween(from: number, to: number): Promise<BusyInterval[]> {
  await initDb();
  // Widen the query by a day either side so a booking that starts before the
  // window but whose trailing buffer reaches into it is still caught.
  const pad = 24 * 60 * 60_000;
  const result = await db.execute({
    sql: `SELECT b.start_at, b.end_at,
                 e.buffer_before_min AS bb, e.buffer_after_min AS ba
          FROM coffee_bookings b
          LEFT JOIN coffee_event_types e ON e.id = b.event_type_id
          WHERE b.status = 'confirmed' AND b.end_at > ? AND b.start_at < ?`,
    args: [from - pad, to + pad],
  });
  return (
    result.rows as unknown as {
      start_at: number;
      end_at: number;
      bb: number | null;
      ba: number | null;
    }[]
  ).map((r) => ({
    start: r.start_at - (r.bb ?? 0) * 60_000,
    end: r.end_at + (r.ba ?? 0) * 60_000,
    // The unpadded instant travels alongside the guard span because the daily
    // limit counts meetings, and a meeting is where it starts — not where its
    // lead-in buffer starts, which can be the day before.
    eventStart: r.start_at,
  }));
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
  const settings = await getSettings();
  if (!settings.bookingsOpen) return { days: [], settings };

  // Both keys arrive from the booking page's URL, so neither the shape nor the
  // width of the span is trustworthy — and a well-formed key is no safer than a
  // malformed one. `"9999-12-31"` is both problems at once: its exclusive end
  // is `"10000-01-01"`, which is not a date key at all, and the span in front
  // of it is millions of days. An empty calendar is the right answer to a
  // request nobody sane made; a 500 on a public page is not.
  if (!isValidDateKey(from) || !isValidDateKey(to)) return { days: [], settings };
  const spanEndKey = addDaysToDateKey(to, 1);
  if (!isValidDateKey(spanEndKey)) return { days: [], settings };
  const span = daysBetweenDateKeys(from, to);
  if (span < 0 || span + 1 > MAX_RANGE_DAYS) return { days: [], settings };

  const [rules, overrides] = await Promise.all([listRules(), listOverrides()]);
  const options = slotOptionsFor(eventType, settings, now);

  // The busy window is the span itself plus the horizon needed by buffers, and
  // it is bounded by the host's midnights rather than UTC's — the days being
  // walked are host-local days, so a UTC-midnight window is up to a day out of
  // step with them at the edges.
  const spanStart = zonedTimeToInstant(from, 0, settings.timeZone);
  const spanEnd = zonedTimeToInstant(spanEndKey, 0, settings.timeZone);
  // The guards above should make this unreachable; it stays because it is the
  // last thing between date arithmetic and libsql's argument encoder, which
  // answers a NaN with `RangeError: Only finite numbers can be passed`.
  if (!Number.isFinite(spanStart) || !Number.isFinite(spanEnd)) {
    return { days: [], settings };
  }
  const busy = await busyBetween(spanStart, spanEnd);

  return {
    days: slotsForRange(from, to, options, rules, overrides, busy),
    settings,
  };
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

  const eventType = await getEventType(input.eventTypeId);
  if (!eventType || !eventType.active) {
    return { ok: false, reason: "that meeting type isn't available anymore." };
  }

  const settings = await getSettings();
  if (!settings.bookingsOpen) {
    return { ok: false, reason: settings.closedMessage };
  }

  const guestTimeZone = isValidTimeZone(input.guestTimeZone)
    ? input.guestTimeZone
    : settings.timeZone;

  const [rules, overrides] = await Promise.all([listRules(), listOverrides()]);
  const options = slotOptionsFor(eventType, settings, now);
  const endAt = input.startAt + eventType.durationMin * 60_000;

  // The re-check needs every booking on this host-local day, because the daily
  // limit is counted over exactly that. A fixed ±24h pad around the requested
  // slot isn't the same set: a fall-back day is 25 hours long, so a booking at
  // one end of it falls outside a window measured from the other and the count
  // comes up short — which is a limit bypass for anyone posting a slot
  // directly. Bound it by the day's own midnights instead, extended to cover
  // the slot itself in case the two ever disagree.
  const hostDate = dateKeyInTimeZone(input.startAt, settings.timeZone);
  const dayStart = zonedTimeToInstant(hostDate, 0, settings.timeZone);
  const dayEnd = zonedTimeToInstant(addDaysToDateKey(hostDate, 1), 0, settings.timeZone);
  const busy = await busyBetween(
    Math.min(dayStart, input.startAt),
    Math.max(dayEnd, endAt),
  );

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

export async function getBookingByCancelToken(token: string): Promise<Booking | null> {
  await initDb();
  const result = await db.execute({
    sql: "SELECT * FROM coffee_bookings WHERE cancel_token = ?",
    args: [token],
  });
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

export type BookingWithType = Booking & { eventType: EventType | null };

/**
 * `order` decides which end of the window the LIMIT keeps, not just how the
 * rows are arranged. Looking backwards at a busy fortnight with `asc` returned
 * the *oldest* rows and silently dropped the most recent ones — the opposite of
 * what a "what just happened" list means. Callers reading history want `desc`.
 */
export async function listBookings(
  {
    status,
    from,
    to,
    limit = 200,
    order = "asc",
  }: {
    status?: "confirmed" | "cancelled";
    from?: number;
    to?: number;
    limit?: number;
    order?: "asc" | "desc";
  } = {},
): Promise<BookingWithType[]> {
  await initDb();
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

  const result = await db.execute({
    sql: `SELECT b.* FROM coffee_bookings b ${where}
          ORDER BY b.start_at ${direction} LIMIT ?`,
    args: [...args, limit],
  });

  const bookings = (result.rows as unknown as DbBooking[]).map(toBooking);
  const typeIds = [...new Set(bookings.map((b) => b.eventTypeId))];
  const types = new Map(
    (await Promise.all(typeIds.map((id) => getEventType(id))))
      .filter((t): t is EventType => t !== null)
      .map((t) => [t.id, t]),
  );

  return bookings.map((b) => ({ ...b, eventType: types.get(b.eventTypeId) ?? null }));
}

/** Counts for the admin dashboard tiles. */
export async function bookingStats(now = Date.now()): Promise<{
  upcoming: number;
  thisWeek: number;
  cancelled: number;
  total: number;
}> {
  await initDb();
  const weekOut = now + 7 * 24 * 60 * 60_000;
  const result = await db.execute({
    sql: `SELECT
            SUM(CASE WHEN status = 'confirmed' AND start_at >= ? THEN 1 ELSE 0 END) AS upcoming,
            SUM(CASE WHEN status = 'confirmed' AND start_at >= ? AND start_at < ? THEN 1 ELSE 0 END) AS this_week,
            SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
            COUNT(*) AS total
          FROM coffee_bookings`,
    args: [now, now, weekOut],
  });
  const row = result.rows[0] as unknown as {
    upcoming: number | null;
    this_week: number | null;
    cancelled: number | null;
    total: number | null;
  };
  return {
    upcoming: Number(row.upcoming ?? 0),
    thisWeek: Number(row.this_week ?? 0),
    cancelled: Number(row.cancelled ?? 0),
    total: Number(row.total ?? 0),
  };
}
