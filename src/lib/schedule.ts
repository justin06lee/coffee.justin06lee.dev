import "server-only";
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

export async function listRules(): Promise<StoredRule[]> {
  await initDb();
  const result = await db.execute(
    `SELECT * FROM coffee_availability_rules ORDER BY weekday ASC, start_min ASC`,
  );
  return (result.rows as unknown as DbAvailabilityRule[]).map((r) => ({
    id: r.id,
    weekday: r.weekday as Weekday,
    startMin: r.start_min,
    endMin: r.end_min,
  }));
}

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

export async function listOverrides(
  { from, to }: { from?: string; to?: string } = {},
): Promise<StoredOverride[]> {
  await initDb();
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
  const result = await db.execute({
    sql: `SELECT * FROM coffee_date_overrides ${where} ORDER BY date ASC, start_min ASC`,
    args,
  });
  return (result.rows as unknown as DbDateOverride[]).map((r) => ({
    id: r.id,
    date: r.date,
    blocked: r.blocked === 1,
    startMin: r.start_min,
    endMin: r.end_min,
    note: r.note,
  }));
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
