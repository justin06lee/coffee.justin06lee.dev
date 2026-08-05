import "server-only";
import { randomUUID, timingSafeEqual } from "crypto";
import { db, initDb } from "./db";

/**
 * Admin auth, ported from hours.justin06lee.dev with the session and
 * rate-limit tables namespaced to this site. Same ADMIN_KEY, separate token
 * store — see the note in db.ts.
 */

const SESSION_TTL = 24 * 60 * 60 * 1000;
export const SESSION_COOKIE_NAME = "coffee_admin_session";

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Pad to equal length so the comparison cost doesn't leak the secret's
  // length: an early `length !== length` return would let an attacker time
  // responses to enumerate the password length. timingSafeEqual still requires
  // equal-length inputs, hence the padding rather than passing raw buffers.
  const maxLen = Math.max(bufA.length, bufB.length);
  const padA = Buffer.alloc(maxLen);
  const padB = Buffer.alloc(maxLen);
  bufA.copy(padA);
  bufB.copy(padB);
  try {
    // Differing lengths must still compare unequal even though the padded
    // buffers match in the padding region.
    return timingSafeEqual(padA, padB) && bufA.length === bufB.length;
  } catch {
    return false;
  }
}

let warnedMissingAdminKey = false;

export function verifyAdminKey(password: string): boolean {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) {
    if (!warnedMissingAdminKey) {
      warnedMissingAdminKey = true;
      console.warn("[auth] ADMIN_KEY is not set; admin login is disabled.");
    }
    return false;
  }
  if (typeof password !== "string") return false;
  return safeCompare(password, adminKey);
}

export async function createSession(): Promise<string> {
  await initDb();
  const token = randomUUID();
  // One clock reading for both statements, so the row can't be written with a
  // created_at the sweep above it would already consider stale.
  const now = Date.now();
  // Batched into a single round trip: the expiry sweep and the insert are one
  // request, not two.
  await db.batch(
    [
      {
        sql: "DELETE FROM coffee_sessions WHERE created_at < ?",
        args: [now - SESSION_TTL],
      },
      {
        sql: "INSERT INTO coffee_sessions (token, created_at) VALUES (?, ?)",
        args: [token, now],
      },
    ],
    "write",
  );
  return token;
}

export async function validateSession(token: string): Promise<boolean> {
  await initDb();
  // The TTL is in the WHERE clause, so an expired token simply doesn't match
  // and this stays one round trip on every path — it runs on every admin page
  // load and every admin server action. Expired rows are not leaked by the
  // missing DELETE: createSession() sweeps everything older than the TTL on
  // each login.
  const result = await db.execute({
    sql: "SELECT 1 FROM coffee_sessions WHERE token = ? AND created_at >= ?",
    args: [token, Date.now() - SESSION_TTL],
  });
  return result.rows.length > 0;
}

export async function destroySession(token: string): Promise<void> {
  await initDb();
  await db.execute({ sql: "DELETE FROM coffee_sessions WHERE token = ?", args: [token] });
}

/* ── rate limiting ── */

const RATE_WINDOW = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const LOCKOUT_WINDOW = 24 * 60 * 60 * 1000;

/**
 * Atomic read-modify-write so concurrent attempts from the same IP can't both
 * read the same count and clobber each other's increment. The CASE order
 * encodes the precedence: a lockout holds for the full 24h and can't be lifted
 * early by the rolling window resetting; otherwise an expired window resets the
 * counter; otherwise increment.
 */
export async function checkLoginRate(ip: string): Promise<boolean> {
  return checkRate("coffee_login_attempts", ip, RATE_WINDOW, MAX_ATTEMPTS, LOCKOUT_WINDOW);
}

/** Booking submissions, so a script can't spray the calendar. */
const BOOKING_WINDOW = 60 * 60 * 1000;
const BOOKING_MAX = 20;

export async function checkBookingRate(ip: string): Promise<boolean> {
  return checkRate("coffee_booking_rate", ip, BOOKING_WINDOW, BOOKING_MAX, BOOKING_WINDOW);
}

// Table names are interpolated because SQLite cannot parameterize identifiers.
// Both call sites pass literals, and the allowlist keeps it that way.
const RATE_TABLES = new Set(["coffee_login_attempts", "coffee_booking_rate"]);

async function checkRate(
  table: string,
  ip: string,
  window: number,
  max: number,
  lockout: number,
): Promise<boolean> {
  if (!RATE_TABLES.has(table)) throw new Error(`unknown rate table: ${table}`);
  await initDb();
  const now = Date.now();
  const windowStart = now - window;
  const lockoutStart = now - lockout;

  // Both statements in one batch: one round trip, and "write" (BEGIN
  // IMMEDIATE) is what actually makes the upsert's read-modify-write atomic
  // against a concurrent request from the same IP.
  const results = await db.batch(
    [
      {
        sql: `DELETE FROM ${table} WHERE first_attempt < ?`,
        args: [lockoutStart],
      },
      {
        sql: `INSERT INTO ${table} (ip, count, first_attempt) VALUES (?, 1, ?)
              ON CONFLICT(ip) DO UPDATE SET
                count = CASE
                  WHEN ${table}.count > ? AND ${table}.first_attempt >= ? THEN ${table}.count
                  WHEN ${table}.first_attempt < ? THEN 1
                  ELSE ${table}.count + 1 END,
                first_attempt = CASE
                  WHEN ${table}.count > ? AND ${table}.first_attempt >= ? THEN ${table}.first_attempt
                  WHEN ${table}.first_attempt < ? THEN ?
                  ELSE ${table}.first_attempt END
              RETURNING count`,
        args: [ip, now, max, lockoutStart, windowStart, max, lockoutStart, windowStart, now],
      },
    ],
    "write",
  );
  // The upsert is the second statement, so its RETURNING row is results[1].
  return Number((results[1].rows[0] as unknown as { count: number }).count) <= max;
}

/**
 * Resolve the client IP from proxy headers. Prefers x-real-ip (set by Vercel
 * and most reverse proxies, and not forwarded from the client), falling back to
 * the rightmost value of x-forwarded-for — the hop nearest to us, not the
 * client-controlled leftmost value.
 */
export function clientIpFrom(headers: Headers): string {
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  const fwd = headers.get("x-forwarded-for");
  if (fwd) {
    const parts = fwd.split(",").map((p) => p.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last;
  }

  return "unknown";
}
