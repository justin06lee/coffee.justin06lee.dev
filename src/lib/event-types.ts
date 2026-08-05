import "server-only";
import type { InStatement, Row } from "@libsql/client";
import { cache } from "react";
import { db, initDb, type DbEventType } from "./db";

export type EventType = {
  id: string;
  slug: string;
  title: string;
  blurb: string | null;
  durationMin: number;
  incrementMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  minNoticeMin: number;
  maxDaysAhead: number;
  dailyLimit: number | null;
  location: string;
  locationDetail: string | null;
  active: boolean;
  position: number;
};

function toEventType(row: DbEventType): EventType {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    blurb: row.blurb,
    durationMin: row.duration_min,
    incrementMin: row.increment_min,
    bufferBeforeMin: row.buffer_before_min,
    bufferAfterMin: row.buffer_after_min,
    minNoticeMin: row.min_notice_min,
    maxDaysAhead: row.max_days_ahead,
    dailyLimit: row.daily_limit,
    location: row.location,
    locationDetail: row.location_detail,
    active: row.active === 1,
    position: row.position,
  };
}

/**
 * Reads are split into a statement builder and a mapper so a page-level loader
 * can put them in a `db.batch` alongside its other reads — one HTTP round trip
 * for the whole page — without copying the SQL and letting the two drift
 * apart. The mapper stays pure: no `db`, so it works on rows from anywhere.
 */
export function eventTypesStatement(
  { includeInactive = false }: { includeInactive?: boolean } = {},
): InStatement {
  return {
    sql: `SELECT * FROM coffee_event_types
          ${includeInactive ? "" : "WHERE active = 1"}
          ORDER BY position ASC, created_at ASC`,
    args: [],
  };
}

export function eventTypeBySlugStatement(slug: string): InStatement {
  return { sql: "SELECT * FROM coffee_event_types WHERE slug = ?", args: [slug] };
}

export function eventTypeByIdStatement(id: string): InStatement {
  return { sql: "SELECT * FROM coffee_event_types WHERE id = ?", args: [id] };
}

export function eventTypesFromRows(rows: Row[]): EventType[] {
  return (rows as unknown as DbEventType[]).map(toEventType);
}

/**
 * Memoized for the request: `generateMetadata` and the page body of
 * `/[slug]` each look the type up, and a booking action looks it up again
 * under `fetchSlots`, so the same row used to be fetched two or three times
 * for one render.
 *
 * Safe only while nothing reads an event type and then writes it inside the
 * same request — a server action and the re-render that follows it share one,
 * so a read-then-write action would go on seeing its own stale copy. Nothing
 * in admin/actions.ts reads before it writes (the form carries the whole
 * record); if you add something that does, it must not read through this.
 */
const eventTypesQuery = cache(
  async (includeInactive: boolean): Promise<EventType[]> => {
    await initDb();
    const result = await db.execute(eventTypesStatement({ includeInactive }));
    return eventTypesFromRows(result.rows);
  },
);

// `cache` keys on argument identity, and an `{ includeInactive: true }` literal
// is a different object at every call site; the boolean inside it is not.
export function listEventTypes(
  { includeInactive = false }: { includeInactive?: boolean } = {},
): Promise<EventType[]> {
  return eventTypesQuery(includeInactive);
}

export const getEventTypeBySlug = cache(
  async (slug: string): Promise<EventType | null> => {
    await initDb();
    const result = await db.execute(eventTypeBySlugStatement(slug));
    return eventTypesFromRows(result.rows)[0] ?? null;
  },
);

export const getEventType = cache(async (id: string): Promise<EventType | null> => {
  await initDb();
  const result = await db.execute(eventTypeByIdStatement(id));
  return eventTypesFromRows(result.rows)[0] ?? null;
});

export type EventTypeInput = Omit<EventType, "id" | "position">;

/**
 * A new type goes to the end of the list. The position is worked out by a
 * subquery inside the insert rather than by reading the max first, so creating
 * a type is one round trip; the subquery sees the table as it was before this
 * row lands, which is the same value the separate SELECT used to return.
 */
export async function createEventType(input: EventTypeInput): Promise<string> {
  await initDb();
  const now = Date.now();
  const id = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO coffee_event_types
            (id, slug, title, blurb, duration_min, increment_min,
             buffer_before_min, buffer_after_min, min_notice_min, max_days_ahead,
             daily_limit, location, location_detail, active, position,
             created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                  (SELECT COALESCE(MAX(position), -1) + 1 FROM coffee_event_types),
                  ?, ?)`,
    args: [
      id,
      input.slug,
      input.title,
      input.blurb,
      input.durationMin,
      input.incrementMin,
      input.bufferBeforeMin,
      input.bufferAfterMin,
      input.minNoticeMin,
      input.maxDaysAhead,
      input.dailyLimit,
      input.location,
      input.locationDetail,
      input.active ? 1 : 0,
      now,
      now,
    ],
  });
  return id;
}

export async function updateEventType(
  id: string,
  input: EventTypeInput,
): Promise<void> {
  await initDb();
  await db.execute({
    sql: `UPDATE coffee_event_types SET
            slug = ?, title = ?, blurb = ?, duration_min = ?, increment_min = ?,
            buffer_before_min = ?, buffer_after_min = ?, min_notice_min = ?,
            max_days_ahead = ?, daily_limit = ?, location = ?,
            location_detail = ?, active = ?, updated_at = ?
          WHERE id = ?`,
    args: [
      input.slug,
      input.title,
      input.blurb,
      input.durationMin,
      input.incrementMin,
      input.bufferBeforeMin,
      input.bufferAfterMin,
      input.minNoticeMin,
      input.maxDaysAhead,
      input.dailyLimit,
      input.location,
      input.locationDetail,
      input.active ? 1 : 0,
      Date.now(),
      id,
    ],
  });
}

/**
 * Deletion is refused while bookings still point at the type. libsql doesn't
 * enforce the declared foreign key, so this check is the constraint — without
 * it a delete would orphan bookings and the admin list would render rows whose
 * event type can't be resolved.
 *
 * The check rides along in the delete's WHERE clause, so the path that works
 * is one round trip. That leaves nothing deleted meaning two different things
 * — bookings blocked it, or the id was already gone — and the admin is shown
 * the reason verbatim, so it's worth a second query to tell them apart. It
 * only runs when the delete did nothing, which is the path nobody is waiting
 * on. A missing id stays a success, as it was when the count came first:
 * the row the admin asked to be rid of isn't there.
 */
export async function deleteEventType(
  id: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  await initDb();
  const result = await db.execute({
    sql: `DELETE FROM coffee_event_types
          WHERE id = ?
            AND NOT EXISTS (SELECT 1 FROM coffee_bookings WHERE event_type_id = ?)`,
    args: [id, id],
  });
  if (result.rowsAffected > 0) return { ok: true };

  const used = await db.execute({
    sql: "SELECT COUNT(*) AS n FROM coffee_bookings WHERE event_type_id = ?",
    args: [id],
  });
  if (Number((used.rows[0] as unknown as { n: number }).n) > 0) {
    return {
      ok: false,
      reason: "this type has bookings against it. archive it instead of deleting.",
    };
  }
  return { ok: true };
}

export async function reorderEventTypes(idsInOrder: string[]): Promise<void> {
  await initDb();
  const now = Date.now();
  await db.batch(
    idsInOrder.map((id, index) => ({
      sql: "UPDATE coffee_event_types SET position = ?, updated_at = ? WHERE id = ?",
      args: [index, now, id],
    })),
  );
}

/** URL-safe, lowercase, collapsed — the shape the booking route expects. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
