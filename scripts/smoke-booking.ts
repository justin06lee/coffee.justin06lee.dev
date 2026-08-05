/**
 * End-to-end smoke test: book the next open slot, read it back, then remove
 * the row so the real calendar is left as it was.
 *
 *   bun --conditions=react-server run scripts/smoke-booking.ts
 *
 * Everything this does is a write. It inserts a *confirmed* booking on the
 * soonest slot the host genuinely has open, and `idx_coffee_bookings_slot` is
 * a partial unique index on start_at where status='confirmed' — so for as long
 * as that row exists it is holding a real opening against a real guest. Hence
 * the guard below, the try/finally, and the hard delete at the end.
 *
 *   --yes-write-to-real-db   required for anything but a local file: database
 *   --keep                   skip cleanup, and print the cancel token
 */
import { db } from "../src/lib/db";
import { availabilityFor, createBooking, getBookingByCancelToken } from "../src/lib/bookings";
import { getEventTypeBySlug } from "../src/lib/event-types";
import { getSettings } from "../src/lib/settings";
import { addDaysToDateKey, dateKeyInTimeZone, formatFullStamp } from "../src/lib/time";

const keep = process.argv.includes("--keep");

// bun loads the repo's .env before any of this runs, and that file holds the
// live production credentials — so the unadorned command books a real slot on
// the real calendar, which is not what anyone types `smoke` expecting. Only a
// local file: database goes ahead unasked. The check sits here rather than
// above the imports because `db` connects on first use, not at import: this
// path exits without ever opening a client. Only the scheme goes in the
// message, since a Turso URL can carry credentials in its query string.
const url = process.env.TURSO_DATABASE_URL ?? "";
if (!url.startsWith("file:") && !process.argv.includes("--yes-write-to-real-db")) {
  const target = url ? `a ${url.split(":")[0]}: database` : "an unset TURSO_DATABASE_URL";
  console.error(
    `smoke-booking: refusing to run against ${target}. This script inserts a ` +
      "confirmed booking on the host's soonest open slot, tries to double-book " +
      "it, then deletes what it made — and every moment that row exists it is " +
      "blocking that slot for everyone else. Point TURSO_DATABASE_URL at a " +
      "file: database, or pass --yes-write-to-real-db if that really is what " +
      "you want.",
  );
  process.exit(1);
}

const eventType = await getEventTypeBySlug("coffee");
if (!eventType) throw new Error("no 'coffee' event type");
const settings = await getSettings();

const today = dateKeyInTimeZone(Date.now(), settings.timeZone);
const { days } = await availabilityFor(eventType, today, addDaysToDateKey(today, 14));
const firstOpen = days.find((d) => d.slots.length > 0);
if (!firstOpen) throw new Error("no open slots in the next fortnight");
const slot = firstOpen.slots[0]!;
console.log("booking", formatFullStamp(slot, settings.timeZone));

// Every row this run inserted. Collected as they are made rather than named at
// the end, so cleanup doesn't depend on how far down the script got.
const created: string[] = [];

/**
 * Hard delete rather than cancel: a cancelled row would linger in the admin
 * list forever, and these were never real.
 *
 * Each id gets its own statement so one failure can't strand the other — a
 * confirmed row left behind holds the host's next opening until someone
 * deletes it by hand, so a failure here is worth shouting about.
 */
async function cleanup(): Promise<void> {
  // Taken, not read: a second call (the finally after a signal, say) is a no-op.
  const ids = created.splice(0);
  if (ids.length === 0) return;
  if (keep) {
    console.log("--keep: left behind, delete when done:", ids.join(", "));
    return;
  }

  let failed = 0;
  for (const id of ids) {
    try {
      await db.execute({
        sql: "DELETE FROM coffee_bookings WHERE id = ?",
        args: [id],
      });
    } catch (err) {
      failed++;
      process.exitCode = 1;
      console.error(
        `smoke-booking: FAILED to delete booking ${id}. It is still confirmed ` +
          "and still blocking that slot — delete it by hand.",
        err,
      );
    }
  }
  if (failed === 0) console.log("cleaned up. pass --keep to leave the booking in place.");
}

// finally doesn't run on Ctrl-C, and the stretch it covers is exactly the
// stretch where a real slot is held.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.error(`smoke-booking: ${signal} — cleaning up before exiting.`);
    void cleanup().finally(() => process.exit(signal === "SIGINT" ? 130 : 143));
  });
}

const result = await createBooking({
  eventTypeId: eventType.id,
  startAt: slot,
  guestName: "smoke test",
  guestEmail: "smoke@example.com",
  guestTimeZone: "Europe/Berlin",
  notes: "automated smoke test — safe to delete",
});
if (!result.ok) throw new Error(`booking failed: ${result.reason}`);
created.push(result.booking.id);
console.log("ok, booked", result.booking.id);

try {
  // The slot must now be gone from availability.
  const after = await availabilityFor(eventType, today, addDaysToDateKey(today, 14));
  const stillOffered = after.days.some((d) => d.slots.includes(slot));
  console.log("slot still offered after booking:", stillOffered, stillOffered ? "  <-- BUG" : "(correct)");

  // Booking the same slot again must be refused. On the day it isn't — the
  // regression this script exists to catch — the second row is every bit as
  // real as the first, so it goes on the cleanup list before anything else.
  const dupe = await createBooking({
    eventTypeId: eventType.id,
    startAt: slot,
    guestName: "smoke test 2",
    guestEmail: "smoke2@example.com",
    guestTimeZone: "UTC",
    notes: null,
  });
  if (dupe.ok) created.push(dupe.booking.id);
  console.log("double-book refused:", !dupe.ok, dupe.ok ? "  <-- BUG" : `("${dupe.reason}")`);

  const readBack = await getBookingByCancelToken(result.booking.cancelToken);
  console.log("read back by token:", readBack?.guestName, readBack?.status);

  // The cancel token is a bearer capability: it opens /booked/[token] and the
  // ICS route for anyone holding it. Putting it in CI logs and shell history
  // only buys something for a row that is going to outlive the run.
  if (keep) console.log("TOKEN_FOR_CURL=" + result.booking.cancelToken);
} finally {
  await cleanup();
}
