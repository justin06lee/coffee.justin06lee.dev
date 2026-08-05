import "server-only";
import type { InStatement, Row } from "@libsql/client";
import { cache } from "react";
import {
  db,
  initDb,
  type DbAvailabilityRule,
  type DbDateOverride,
} from "./db";
import type { DateOverride, WeeklyRule } from "./availability";
import type { Weekday } from "./time";

export type StoredRule = WeeklyRule & { id: string };
export type StoredOverride = DateOverride & { id: string; note: string | null };

/**
 * Reads are split into a statement and a mapper so a page-level loader can put
 * them in a `db.batch` alongside its other reads — one HTTP round trip for the
 * whole page — without copying the SQL and letting the two drift apart. The
 * mappers stay pure: no `db`, no clock, so they work on rows from anywhere.
 */
export const rulesStatement: InStatement =
  `SELECT * FROM coffee_availability_rules ORDER BY weekday ASC, start_min ASC`;

export function rulesFromRows(rows: Row[]): StoredRule[] {
  return (rows as unknown as DbAvailabilityRule[]).map((r) => ({
    id: r.id,
    weekday: r.weekday as Weekday,
    startMin: r.start_min,
    endMin: r.end_min,
  }));
}

/**
 * Memoized for the request, since the availability maths reads the schedule
 * once per event type and the admin page reads it again to render the editor.
 *
 * Safe only while nothing reads the schedule and then writes it inside the
 * same request — a server action and the re-render that follows it share one,
 * so a read-then-write action would go on seeing its own stale copy. Nothing
 * in admin/actions.ts reads before it writes (`replaceRules` takes the whole
 * grid from the form); if you add something that does, it must not read
 * through this.
 */
export const listRules = cache(async (): Promise<StoredRule[]> => {
  await initDb();
  const result = await db.execute(rulesStatement);
  return rulesFromRows(result.rows);
});

/**
 * Replace the whole weekly schedule in one shot.
 *
 * The editor hands back the full grid every save, so a delete-then-insert is
 * both simpler and more correct than diffing: it can't leave a row behind that
 * the user removed from a day they didn't otherwise touch. `batch` runs the
 * statements in a transaction, so a failure part-way can't wipe the schedule.
 */
export async function replaceRules(rules: WeeklyRule[]): Promise<void> {
  await initDb();
  const now = Date.now();
  await db.batch([
    { sql: "DELETE FROM coffee_availability_rules", args: [] },
    ...rules.map((r) => ({
      sql: `INSERT INTO coffee_availability_rules
              (id, weekday, start_min, end_min, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [crypto.randomUUID(), r.weekday, r.startMin, r.endMin, now, now],
    })),
  ]);
}

export function overridesStatement(
  { from, to }: { from?: string; to?: string } = {},
): InStatement {
  const clauses: string[] = [];
  const args: string[] = [];
  if (from) {
    clauses.push("date >= ?");
    args.push(from);
  }
  if (to) {
    clauses.push("date <= ?");
    args.push(to);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return {
    sql: `SELECT * FROM coffee_date_overrides ${where} ORDER BY date ASC, start_min ASC`,
    args,
  };
}

export function overridesFromRows(rows: Row[]): StoredOverride[] {
  return (rows as unknown as DbDateOverride[]).map((r) => ({
    id: r.id,
    date: r.date,
    blocked: r.blocked === 1,
    startMin: r.start_min,
    endMin: r.end_min,
    note: r.note,
  }));
}

// The memo lives on the inner function because `cache` keys on argument
// identity: a fresh `{ from: today }` literal at each call site is never the
// same object, so memoizing the public shape would never hit. The strings are.
const overridesQuery = cache(
  async (from?: string, to?: string): Promise<StoredOverride[]> => {
    await initDb();
    const result = await db.execute(overridesStatement({ from, to }));
    return overridesFromRows(result.rows);
  },
);

export function listOverrides(
  { from, to }: { from?: string; to?: string } = {},
): Promise<StoredOverride[]> {
  return overridesQuery(from, to);
}

export async function addOverride(input: {
  date: string;
  blocked: boolean;
  startMin: number | null;
  endMin: number | null;
  note: string | null;
}): Promise<string> {
  await initDb();
  const now = Date.now();
  const id = crypto.randomUUID();
  await db.execute({
    sql: `INSERT INTO coffee_date_overrides
            (id, date, blocked, start_min, end_min, note, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.date,
      input.blocked ? 1 : 0,
      input.startMin,
      input.endMin,
      input.note,
      now,
      now,
    ],
  });
  return id;
}

export async function deleteOverride(id: string): Promise<void> {
  await initDb();
  await db.execute({ sql: "DELETE FROM coffee_date_overrides WHERE id = ?", args: [id] });
}

/**
 * Blocking a day means "nothing on this date", so any partial windows already
 * recorded for it are removed first — leaving them would be dead data that the
 * admin list would still render as if they were live.
 */
export async function blockDate(date: string, note: string | null): Promise<void> {
  await initDb();
  const now = Date.now();
  await db.batch([
    { sql: "DELETE FROM coffee_date_overrides WHERE date = ?", args: [date] },
    {
      sql: `INSERT INTO coffee_date_overrides
              (id, date, blocked, start_min, end_min, note, created_at, updated_at)
            VALUES (?, ?, 1, NULL, NULL, ?, ?, ?)`,
      args: [crypto.randomUUID(), date, note, now, now],
    },
  ]);
}
