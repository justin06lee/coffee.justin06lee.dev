import "server-only";
import { db, initDb } from "./db";
import {
  type Booking,
  type BookingStats,
  type BookingWithType,
  bookingByCancelTokenStatement,
  bookingStatsFromRows,
  bookingStatsStatement,
  bookingsFromRows,
  bookingsStatement,
  horizonBusyStatement,
  horizonSlots,
  busyFromRows,
} from "./bookings";
import {
  type EventType,
  eventTypeBySlugStatement,
  eventTypesFromRows,
  eventTypesStatement,
} from "./event-types";
import {
  overridesFromRows,
  overridesStatement,
  rulesFromRows,
  rulesStatement,
} from "./schedule";
import { type Settings, settingsFromRows, settingsStatement } from "./settings";

/**
 * Page-shaped loaders: everything a route renders, in one round trip.
 *
 * Each `db.execute` is a separate HTTP request to Turso, so a page that reads
 * settings, then its event types, then availability pays for three of them in
 * series. The `src/lib` modules expose their reads as statement builders and
 * pure row mappers precisely so those reads can be collected into a single
 * `db.batch` — one request, one network latency, however many statements.
 *
 * The composition lives here rather than in the route files so the routes stay
 * declarative: a page awaits one loader and renders it, and the question of
 * which statements can travel together — and why over-fetching is sometimes
 * the cheaper answer — is settled in one place.
 */

/** Everything `/` renders. */
export async function landingData(): Promise<{
  settings: Settings;
  eventTypes: EventType[];
}> {
  await initDb();
  const [settingsResult, typesResult] = await db.batch([
    settingsStatement,
    eventTypesStatement(),
  ]);

  return {
    settings: settingsFromRows(settingsResult.rows),
    eventTypes: eventTypesFromRows(typesResult.rows),
  };
}

/** Everything `/[slug]` renders: the type, the host's settings, and its slots. */
export async function bookingPageData(
  slug: string,
  now = Date.now(),
): Promise<{
  eventType: EventType | null;
  settings: Settings;
  slots: number[];
}> {
  await initDb();

  // The busy window would normally depend on the event type's maxDaysAhead,
  // which isn't known until the first statement comes back. `horizonBusyStatement`
  // asks for the widest window any type could need instead, so all five reads
  // are independent and the page is one round trip — see the comment on it in
  // bookings.ts for why the extra intervals change nothing.
  const [typeResult, settingsResult, rulesResult, overridesResult, busyResult] =
    await db.batch([
      eventTypeBySlugStatement(slug),
      settingsStatement,
      rulesStatement,
      overridesStatement(),
      horizonBusyStatement(now),
    ]);

  const settings = settingsFromRows(settingsResult.rows);
  const eventType = eventTypesFromRows(typeResult.rows)[0] ?? null;
  // An unknown slug is a 404, which the route raises. The settings came back in
  // the same batch, so they're returned rather than thrown away.
  if (!eventType) return { eventType: null, settings, slots: [] };

  return {
    eventType,
    settings,
    slots: horizonSlots(
      eventType,
      settings,
      rulesFromRows(rulesResult.rows),
      overridesFromRows(overridesResult.rows),
      busyFromRows(busyResult.rows),
      now,
    ),
  };
}

/** A booking and the context needed to describe it, for `/booked/[token]` and its .ics. */
export async function bookingRecord(token: string): Promise<{
  booking: Booking | null;
  eventType: EventType | null;
  settings: Settings;
}> {
  await initDb();

  // Every event type is fetched to find the one this booking points at. That
  // looks wasteful, but there are only a handful of them and the alternative —
  // read the booking, then read its type by id — is a chain, so two round
  // trips. Inactive types are included because a booking can point at an
  // archived one, and the confirmation page and the .ics still have to name it.
  const [bookingResult, settingsResult, typesResult] = await db.batch([
    bookingByCancelTokenStatement(token),
    settingsStatement,
    eventTypesStatement({ includeInactive: true }),
  ]);

  const settings = settingsFromRows(settingsResult.rows);
  const booking = bookingsFromRows(bookingResult.rows)[0] ?? null;
  if (!booking) return { booking: null, eventType: null, settings };

  const eventType =
    eventTypesFromRows(typesResult.rows).find((t) => t.id === booking.eventTypeId) ??
    null;

  return { booking, eventType, settings };
}

/** Everything `/admin` renders: the tiles, both lists, and the host's zone. */
export async function adminOverview(now = Date.now()): Promise<{
  stats: BookingStats;
  upcoming: BookingWithType[];
  recent: BookingWithType[];
  settings: Settings;
}> {
  await initDb();

  const [statsResult, upcomingResult, recentResult, settingsResult, typesResult] =
    await db.batch([
      bookingStatsStatement(now),
      bookingsStatement({ status: "confirmed", from: now, limit: 100 }),
      // A short look backwards: the last fortnight is enough to answer "who did
      // I just talk to" without paging. Ordered newest-first because the limit
      // cuts from the far end — ascending kept the fortnight's *oldest* fifty and
      // dropped exactly the meetings this list exists to show.
      bookingsStatement({
        to: now,
        from: now - 14 * 24 * 60 * 60_000,
        limit: 50,
        order: "desc",
      }),
      settingsStatement,
      eventTypesStatement({ includeInactive: true }),
    ]);

  // One map of types serves both lists, so the join that used to be a query per
  // booking is a lookup per booking. Inactive types are included: a booking can
  // point at an archived one and its row still has to render a title.
  const types = new Map(eventTypesFromRows(typesResult.rows).map((t) => [t.id, t]));
  const withType = (b: Booking): BookingWithType => ({
    ...b,
    eventType: types.get(b.eventTypeId) ?? null,
  });

  return {
    stats: bookingStatsFromRows(statsResult.rows),
    upcoming: bookingsFromRows(upcomingResult.rows).map(withType),
    recent: bookingsFromRows(recentResult.rows).map(withType),
    settings: settingsFromRows(settingsResult.rows),
  };
}
