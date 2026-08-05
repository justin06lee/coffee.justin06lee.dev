/**
 * Booking commit path, against a real database.
 *
 * These are the cases the pure slot-engine tests structurally cannot reach:
 * what `busyBetween` actually hands the engine, what window the commit reads
 * over, and what two requests do to each other when they interleave. Every one
 * of them was a live bug that a pure test agreed was fine.
 *
 * The database is a throwaway `file:` one created per run. `db.ts` connects on
 * first use rather than at import, which is the only reason setting the env var
 * here works — but the guard below is not a formality either: the repo's `.env`
 * points at the production Turso instance, and these tests insert *confirmed*
 * bookings on a host's real openings.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// `bookings.ts` and everything under it import `server-only`, which throws
// outside a react-server condition. Vitest runs plain node, so the marker is
// stubbed rather than the whole suite being run under a different resolver.
vi.mock("server-only", () => ({}));

const dir = mkdtempSync(join(tmpdir(), "coffee-bookings-test-"));
process.env.TURSO_DATABASE_URL = `file:${join(dir, "test.db")}`;
delete process.env.TURSO_AUTH_TOKEN;

const { db, initDb } = await import("./db");
const { availabilityFor, busyBetween, createBooking } = await import("./bookings");
const { createEventType, getEventType } = await import("./event-types");
const { replaceRules } = await import("./schedule");
const { MAX_RANGE_DAYS } = await import("./availability");
const { addDaysToDateKey, zonedTimeToInstant } = await import("./time");
type EventTypeInput = Parameters<typeof createEventType>[0];

const LA = "America/Los_Angeles";

beforeAll(async () => {
  expect(process.env.TURSO_DATABASE_URL?.startsWith("file:")).toBe(true);
  await initDb();
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

// `initDb` seeds an empty schema with defaults; clearing here rather than in a
// fresh database per test keeps the seed from coming back and lets each test
// state its own calendar in full.
beforeEach(async () => {
  await db.execute("DELETE FROM coffee_bookings");
  await db.execute("DELETE FROM coffee_event_types");
  await db.execute("DELETE FROM coffee_availability_rules");
  await db.execute("DELETE FROM coffee_date_overrides");
});

/** Open every day, all day, so a test can put a meeting at any wall time. */
async function openAroundTheClock(): Promise<void> {
  await replaceRules(
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday: weekday as 0,
      startMin: 0,
      endMin: 24 * 60,
    })),
  );
}

async function makeEventType(patch: Partial<EventTypeInput> = {}): Promise<string> {
  return createEventType({
    slug: patch.slug ?? "coffee",
    title: "coffee",
    blurb: null,
    durationMin: 30,
    incrementMin: 30,
    bufferBeforeMin: 0,
    bufferAfterMin: 0,
    minNoticeMin: 0,
    maxDaysAhead: 400,
    dailyLimit: null,
    location: "video",
    locationDetail: null,
    active: true,
    ...patch,
  });
}

function book(eventTypeId: string, startAt: number, name: string, now: number) {
  return createBooking(
    {
      eventTypeId,
      startAt,
      guestName: name,
      guestEmail: `${name}@example.com`,
      guestTimeZone: "UTC",
      notes: null,
    },
    now,
  );
}

async function confirmedCount(): Promise<number> {
  const rows = await db.execute(
    "SELECT COUNT(*) AS n FROM coffee_bookings WHERE status = 'confirmed'",
  );
  return Number((rows.rows[0] as unknown as { n: number }).n);
}

describe("busyBetween", () => {
  it("reports the guard span and the meeting's own instant separately", async () => {
    await openAroundTheClock();
    const id = await makeEventType({ bufferBeforeMin: 30, bufferAfterMin: 15 });
    const now = zonedTimeToInstant("2026-07-01", 0, LA);
    const startAt = zonedTimeToInstant("2026-08-03", 0, LA);
    expect((await book(id, startAt, "a", now)).ok).toBe(true);

    const [busy] = await busyBetween(startAt - 86_400_000, startAt + 86_400_000);
    expect(busy.eventStart).toBe(startAt);
    expect(busy.start).toBe(startAt - 30 * 60_000);
    expect(busy.end).toBe(startAt + 45 * 60_000);
  });
});

describe("daily limit", () => {
  it("is not defeated by a lead-in buffer that crosses local midnight", async () => {
    // The buffer widens the busy interval back into the previous day. Counting
    // the day off that widened span meant a midnight meeting was tallied
    // against the day before: the picker kept offering the full day, and a
    // third booking went in on a calendar capped at two.
    await openAroundTheClock();
    const id = await makeEventType({ dailyLimit: 2, bufferBeforeMin: 30 });
    const eventType = (await getEventType(id))!;
    const now = zonedTimeToInstant("2026-07-01", 0, LA);
    const day = "2026-08-03";

    expect((await book(id, zonedTimeToInstant(day, 0, LA), "a", now)).ok).toBe(true);
    expect((await book(id, zonedTimeToInstant(day, 120, LA), "b", now)).ok).toBe(true);

    const { days } = await availabilityFor(eventType, day, day, now);
    expect(days[0].slots).toEqual([]);

    const third = await book(id, zonedTimeToInstant(day, 240, LA), "c", now);
    expect(third.ok).toBe(false);
    expect(await confirmedCount()).toBe(2);

    // The day before gained nothing: it is empty, and still open.
    const before = await availabilityFor(eventType, "2026-08-02", "2026-08-02", now);
    expect(before.days[0].slots.length).toBeGreaterThan(0);
  });

  it("holds on a 25-hour fall-back day", async () => {
    // 2026-11-01 is 25 hours long in LA, so the commit's old ±24h window,
    // measured from a slot at one end of the day, could not see a booking at
    // the other — and the count came up one short. The picker uses a wider
    // window, so only a direct or stale POST reached it.
    await openAroundTheClock();
    const id = await makeEventType({ dailyLimit: 2 });
    const now = zonedTimeToInstant("2026-10-01", 0, LA);
    const day = "2026-11-01";

    expect((await book(id, zonedTimeToInstant(day, 23 * 60, LA), "a", now)).ok).toBe(true);
    expect((await book(id, zonedTimeToInstant(day, 23 * 60 + 30, LA), "b", now)).ok).toBe(
      true,
    );

    const third = await book(id, zonedTimeToInstant(day, 0, LA), "c", now);
    expect(third.ok).toBe(false);
    expect(await confirmedCount()).toBe(2);
  });
});

describe("createBooking races", () => {
  it("lets only one of two concurrent overlapping bookings commit", async () => {
    // Different event types, so the two starts differ and the unique index on
    // `start_at` never fires: a 45-minute 9:00 and a 30-minute 9:30 both passed
    // the availability check and both landed, leaving the host double-booked
    // from 9:30 to 9:45. Run one after the other the second is refused, which
    // is what makes this a race rather than a rule.
    await openAroundTheClock();
    const long = await makeEventType({ slug: "long", durationMin: 45, incrementMin: 15 });
    const short = await makeEventType({ slug: "short", durationMin: 30, incrementMin: 15 });
    const now = zonedTimeToInstant("2026-07-01", 0, LA);
    const day = "2026-08-03";

    // Deliberately not awaited in between — the whole point is that both
    // requests read availability before either has written.
    const first = book(long, zonedTimeToInstant(day, 9 * 60, LA), "a", now);
    const second = book(short, zonedTimeToInstant(day, 9 * 60 + 30, LA), "b", now);
    const results = await Promise.all([first, second]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)?.ok === false).toBe(true);
    expect(await confirmedCount()).toBe(1);
  });

  it("still refuses an identical start", async () => {
    await openAroundTheClock();
    const id = await makeEventType();
    const now = zonedTimeToInstant("2026-07-01", 0, LA);
    const startAt = zonedTimeToInstant("2026-08-03", 9 * 60, LA);

    const results = await Promise.all([
      book(id, startAt, "a", now),
      book(id, startAt, "b", now),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await confirmedCount()).toBe(1);
  });

  it("does not treat a cancelled booking as occupying the slot", async () => {
    await openAroundTheClock();
    const id = await makeEventType();
    const now = zonedTimeToInstant("2026-07-01", 0, LA);
    const startAt = zonedTimeToInstant("2026-08-03", 9 * 60, LA);

    const first = await book(id, startAt, "a", now);
    expect(first.ok).toBe(true);
    await db.execute("UPDATE coffee_bookings SET status = 'cancelled'");

    expect((await book(id, startAt, "b", now)).ok).toBe(true);
  });
});

describe("availabilityFor spans", () => {
  it("answers an out-of-range span with an empty calendar, not a database error", async () => {
    // `"9999-12-31"` is a well-formed key whose exclusive end is
    // `"10000-01-01"`, which `Date` cannot parse. The NaN that produced went
    // into the busy query's arguments, and libsql answered with
    // `RangeError: Only finite numbers can be passed as arguments`.
    await openAroundTheClock();
    const eventType = (await getEventType(await makeEventType()))!;
    const now = zonedTimeToInstant("2026-07-01", 0, LA);

    for (const [from, to] of [
      ["2026-08-03", "9999-12-31"],
      ["0001-01-01", "9999-12-30"],
      ["2026-08-03", addDaysToDateKey("2026-08-03", MAX_RANGE_DAYS)],
      ["2026-08-09", "2026-08-03"],
      ["not-a-date", "2026-08-09"],
      ["2026-08-03", "2026-02-30"],
    ] as const) {
      const { days } = await availabilityFor(eventType, from, to, now);
      expect(days, `${from}..${to}`).toEqual([]);
    }
  });

  it("still answers a normal span", async () => {
    await openAroundTheClock();
    const eventType = (await getEventType(await makeEventType()))!;
    const now = zonedTimeToInstant("2026-07-01", 0, LA);
    const { days } = await availabilityFor(eventType, "2026-08-03", "2026-08-09", now);
    expect(days).toHaveLength(7);
    expect(days.every((d) => d.slots.length > 0)).toBe(true);
  });
});
