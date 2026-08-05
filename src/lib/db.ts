import "server-only";
import { createClient, type Client } from "@libsql/client";

/**
 * The same Turso database every justin06lee.dev site talks to, so every table
 * here is namespaced `coffee_`. Sessions get their own table rather than
 * reusing the shared `sessions` one: the sites share an ADMIN_KEY but there is
 * no reason a token lifted from one should unlock another.
 */

let client: Client | null = null;

function connect(): Client {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    throw new Error(
      "TURSO_DATABASE_URL is not set. Set it and TURSO_AUTH_TOKEN in the " +
        "environment — .env locally, project environment variables on Vercel.",
    );
  }
  // Only the scheme goes in the message. A Turso URL can carry credentials in
  // the query string, and this error is going to end up in a build log.
  if (!authToken && !url.startsWith("file:")) {
    throw new Error(
      `TURSO_AUTH_TOKEN is not set, but TURSO_DATABASE_URL is remote ` +
        `(${url.split(":")[0]}:). A remote Turso database requires a token.`,
    );
  }

  return createClient({ url, authToken });
}

/**
 * Connects on first use rather than at import.
 *
 * This is a Proxy so the ~40 `db.execute(...)` call sites stay as they are,
 * but the point is the timing, not the shape: built at module scope, a missing
 * env var took down `next build` itself, because collecting page data imports
 * this file. A deploy configured in the wrong order failed with
 * `URL_INVALID: The URL 'undefined' is not in a valid format` and no clue
 * which variable was meant. Now the build succeeds without any database
 * config, and a genuinely misconfigured deploy fails per-request, naming the
 * variable it wants.
 */
export const db: Client = new Proxy({} as Client, {
  get(_target, prop) {
    client ??= connect();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

// Memoize so initDb() costs ~0 after the first call in a worker process.
// Without this, every lib function call re-runs the full schema batch — adding
// hundreds of ms to each page load.
let initPromise: Promise<void> | null = null;

export function initDb(): Promise<void> {
  if (!initPromise) initPromise = doInit();
  return initPromise;
}

async function doInit(): Promise<void> {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS coffee_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS coffee_event_types (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      blurb TEXT,
      duration_min INTEGER NOT NULL DEFAULT 30,
      increment_min INTEGER NOT NULL DEFAULT 30,
      buffer_before_min INTEGER NOT NULL DEFAULT 0,
      buffer_after_min INTEGER NOT NULL DEFAULT 0,
      min_notice_min INTEGER NOT NULL DEFAULT 720,
      max_days_ahead INTEGER NOT NULL DEFAULT 45,
      daily_limit INTEGER,
      location TEXT NOT NULL DEFAULT 'video',
      location_detail TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      position INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_coffee_event_types_slug
      ON coffee_event_types(slug)`,
    `CREATE TABLE IF NOT EXISTS coffee_availability_rules (
      id TEXT PRIMARY KEY,
      weekday INTEGER NOT NULL,
      start_min INTEGER NOT NULL,
      end_min INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_coffee_rules_weekday
      ON coffee_availability_rules(weekday)`,
    `CREATE TABLE IF NOT EXISTS coffee_date_overrides (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      blocked INTEGER NOT NULL DEFAULT 0,
      start_min INTEGER,
      end_min INTEGER,
      note TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_coffee_overrides_date
      ON coffee_date_overrides(date)`,
    // FK clauses are declarative; libsql does not enable PRAGMA foreign_keys
    // per-connection, so the event-type delete path enforces this at the app
    // level (see event-types.ts deleteEventType).
    `CREATE TABLE IF NOT EXISTS coffee_bookings (
      id TEXT PRIMARY KEY,
      event_type_id TEXT NOT NULL,
      start_at INTEGER NOT NULL,
      end_at INTEGER NOT NULL,
      host_date TEXT NOT NULL,
      guest_name TEXT NOT NULL,
      guest_email TEXT NOT NULL,
      guest_timezone TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'confirmed',
      cancel_token TEXT NOT NULL,
      cancelled_at INTEGER,
      cancel_reason TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (event_type_id) REFERENCES coffee_event_types(id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_coffee_bookings_start ON coffee_bookings(start_at)`,
    `CREATE INDEX IF NOT EXISTS idx_coffee_bookings_date ON coffee_bookings(host_date)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_coffee_bookings_cancel_token
      ON coffee_bookings(cancel_token)`,
    // The last line of defence against a double-booking race. Two guests can
    // both pass the app-level availability check on the same slot if their
    // requests interleave between the read and the insert; this makes the
    // second insert fail instead of quietly overbooking the host. One host,
    // one calendar — so the constraint is on the instant alone, not on
    // (instant, event type).
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_coffee_bookings_slot
      ON coffee_bookings(start_at) WHERE status = 'confirmed'`,
    `CREATE TABLE IF NOT EXISTS coffee_sessions (
      token TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS coffee_login_attempts (
      ip TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      first_attempt INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS coffee_booking_rate (
      ip TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      first_attempt INTEGER NOT NULL
    )`,
  ]);

  await seed();
}

/**
 * First-run content. Each block is guarded on its own table being empty rather
 * than on a global "seeded" flag, so deleting every event type and starting
 * over doesn't silently resurrect the defaults on the next deploy — only a
 * genuinely fresh table gets them.
 */
async function seed(): Promise<void> {
  const now = Date.now();

  const rules = await db.execute("SELECT COUNT(*) AS n FROM coffee_availability_rules");
  if (Number((rules.rows[0] as unknown as { n: number }).n) === 0) {
    await db.batch(
      [1, 2, 3, 4, 5].map((weekday) => ({
        sql: `INSERT INTO coffee_availability_rules
                (id, weekday, start_min, end_min, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [crypto.randomUUID(), weekday, 9 * 60, 17 * 60, now, now],
      })),
    );
  }

  const types = await db.execute("SELECT COUNT(*) AS n FROM coffee_event_types");
  if (Number((types.rows[0] as unknown as { n: number }).n) === 0) {
    const defaults = [
      {
        slug: "coffee",
        title: "coffee",
        blurb: "no agenda. whatever you want to talk about.",
        duration: 30,
        position: 0,
      },
      {
        slug: "code-review",
        title: "code review",
        blurb: "bring a pr, a repo, or a design doc and we'll go through it.",
        duration: 45,
        position: 1,
      },
      {
        slug: "quick-sync",
        title: "quick sync",
        blurb: "one question, one answer. in and out.",
        duration: 15,
        position: 2,
      },
    ];
    await db.batch(
      defaults.map((d) => ({
        sql: `INSERT INTO coffee_event_types
                (id, slug, title, blurb, duration_min, increment_min,
                 buffer_before_min, buffer_after_min, min_notice_min,
                 max_days_ahead, daily_limit, location, location_detail,
                 active, position, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, 15, 0, 15, 720, 45, NULL, 'video', NULL, 1, ?, ?, ?)`,
        args: [
          crypto.randomUUID(),
          d.slug,
          d.title,
          d.blurb,
          d.duration,
          d.position,
          now,
          now,
        ],
      })),
    );
  }
}

/* ── row shapes ── */

export type DbEventType = {
  id: string;
  slug: string;
  title: string;
  blurb: string | null;
  duration_min: number;
  increment_min: number;
  buffer_before_min: number;
  buffer_after_min: number;
  min_notice_min: number;
  max_days_ahead: number;
  daily_limit: number | null;
  location: string;
  location_detail: string | null;
  active: number;
  position: number;
  created_at: number;
  updated_at: number;
};

export type DbAvailabilityRule = {
  id: string;
  weekday: number;
  start_min: number;
  end_min: number;
  created_at: number;
  updated_at: number;
};

export type DbDateOverride = {
  id: string;
  date: string;
  blocked: number;
  start_min: number | null;
  end_min: number | null;
  note: string | null;
  created_at: number;
  updated_at: number;
};

export type DbBooking = {
  id: string;
  event_type_id: string;
  start_at: number;
  end_at: number;
  host_date: string;
  guest_name: string;
  guest_email: string;
  guest_timezone: string;
  notes: string | null;
  status: string;
  cancel_token: string;
  cancelled_at: number | null;
  cancel_reason: string | null;
  created_at: number;
  updated_at: number;
};
