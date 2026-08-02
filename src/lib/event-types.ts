import "server-only";
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

export async function listEventTypes(
  { includeInactive = false }: { includeInactive?: boolean } = {},
): Promise<EventType[]> {
  await initDb();
  const result = await db.execute({
    sql: `SELECT * FROM coffee_event_types
          ${includeInactive ? "" : "WHERE active = 1"}
          ORDER BY position ASC, created_at ASC`,
    args: [],
  });
  return (result.rows as unknown as DbEventType[]).map(toEventType);
}

export async function getEventTypeBySlug(slug: string): Promise<EventType | null> {
  await initDb();
  const result = await db.execute({
    sql: "SELECT * FROM coffee_event_types WHERE slug = ?",
    args: [slug],
  });
  const row = (result.rows as unknown as DbEventType[])[0];
  return row ? toEventType(row) : null;
}

export async function getEventType(id: string): Promise<EventType | null> {
  await initDb();
  const result = await db.execute({
    sql: "SELECT * FROM coffee_event_types WHERE id = ?",
    args: [id],
  });
  const row = (result.rows as unknown as DbEventType[])[0];
  return row ? toEventType(row) : null;
}

export type EventTypeInput = Omit<EventType, "id" | "position">;

export async function createEventType(input: EventTypeInput): Promise<string> {
  await initDb();
  const now = Date.now();
  const id = crypto.randomUUID();
  const next = await db.execute(
    "SELECT COALESCE(MAX(position), -1) + 1 AS n FROM coffee_event_types",
  );
  await db.execute({
    sql: `INSERT INTO coffee_event_types
            (id, slug, title, blurb, duration_min, increment_min,
             buffer_before_min, buffer_after_min, min_notice_min, max_days_ahead,
             daily_limit, location, location_detail, active, position,
             created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      Number((next.rows[0] as unknown as { n: number }).n),
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
 */
export async function deleteEventType(
  id: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  await initDb();
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
  await db.execute({ sql: "DELETE FROM coffee_event_types WHERE id = ?", args: [id] });
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
