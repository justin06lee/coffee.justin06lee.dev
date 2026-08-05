import "server-only";
import type { InStatement, Row } from "@libsql/client";
import { cache } from "react";
import { db, initDb } from "./db";
import { isValidTimeZone } from "./time";

/**
 * Host-wide settings. Small enough to read as one row set, and read once per
 * request rather than cached across them, so there's nothing to invalidate
 * when the admin saves.
 */
export type Settings = {
  /** The zone every availability rule and override is expressed in. */
  timeZone: string;
  /** Shown as the person being booked. */
  hostName: string;
  /** Optional line under the host name on the landing page. */
  hostBio: string;
  /** Where meetings happen when an event type doesn't override it. */
  defaultLocation: string;
  /** Turns the whole booking surface off without deleting anything. */
  bookingsOpen: boolean;
  /** Copy shown in place of the picker when bookings are closed. */
  closedMessage: string;
};

export const DEFAULT_SETTINGS: Settings = {
  timeZone: "America/Los_Angeles",
  hostName: "justin",
  hostBio: "software engineer. i like build tools, type systems, and coffee.",
  defaultLocation: "google meet — link in the invite",
  bookingsOpen: true,
  closedMessage: "the calendar is closed right now. check back in a bit.",
};

/**
 * The read, split from the function that runs it so a page-level loader can
 * put it in a `db.batch` next to its other reads — one HTTP round trip for the
 * whole page — without copying the SQL and letting the two drift apart.
 */
export const settingsStatement: InStatement = "SELECT key, value FROM coffee_settings";

export function settingsFromRows(rows: Row[]): Settings {
  const stored = new Map(
    (rows as unknown as { key: string; value: string }[]).map((r) => [r.key, r.value]),
  );

  const read = (key: keyof Settings): string | undefined => stored.get(key);
  const timeZone = read("timeZone");

  return {
    // A stored zone that this runtime's Intl doesn't recognise would make every
    // slot computation throw, so fall back rather than propagate it.
    timeZone:
      timeZone && isValidTimeZone(timeZone) ? timeZone : DEFAULT_SETTINGS.timeZone,
    hostName: read("hostName") ?? DEFAULT_SETTINGS.hostName,
    hostBio: read("hostBio") ?? DEFAULT_SETTINGS.hostBio,
    defaultLocation: read("defaultLocation") ?? DEFAULT_SETTINGS.defaultLocation,
    bookingsOpen: (read("bookingsOpen") ?? "1") !== "0",
    closedMessage: read("closedMessage") ?? DEFAULT_SETTINGS.closedMessage,
  };
}

/**
 * Memoized for the request: a page and the things it renders both want
 * settings, and `availabilityFor` asks again underneath them, so the same row
 * set used to go over the wire three times for one page.
 *
 * This is only safe while nothing reads settings and then writes them inside
 * the same request — a server action and the re-render that follows it share
 * one, so a read-then-write action would go on seeing its own stale copy.
 * Nothing in admin/actions.ts reads before it writes; if you add something
 * that does, it must not read through this.
 */
export const getSettings = cache(async (): Promise<Settings> => {
  await initDb();
  const result = await db.execute(settingsStatement);
  return settingsFromRows(result.rows);
});

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  await initDb();
  const now = Date.now();
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;

  await db.batch(
    entries.map(([key, value]) => ({
      sql: `INSERT INTO coffee_settings (key, value, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                          updated_at = excluded.updated_at`,
      args: [key, typeof value === "boolean" ? (value ? "1" : "0") : String(value), now],
    })),
  );
}
