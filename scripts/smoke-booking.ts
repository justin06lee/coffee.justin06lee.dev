/**
 * End-to-end smoke test: book the next open slot, read it back, then remove
 * the row so the real calendar is left as it was.
 *
 *   bun --conditions=react-server run scripts/smoke-booking.ts
 */
import { db } from "../src/lib/db";
import { availabilityFor, createBooking, getBookingByCancelToken } from "../src/lib/bookings";
import { getEventTypeBySlug } from "../src/lib/event-types";
import { getSettings } from "../src/lib/settings";
import { addDaysToDateKey, dateKeyInTimeZone, formatFullStamp } from "../src/lib/time";

const eventType = await getEventTypeBySlug("coffee");
if (!eventType) throw new Error("no 'coffee' event type");
const settings = await getSettings();

const today = dateKeyInTimeZone(Date.now(), settings.timeZone);
const { days } = await availabilityFor(eventType, today, addDaysToDateKey(today, 14));
const firstOpen = days.find((d) => d.slots.length > 0);
if (!firstOpen) throw new Error("no open slots in the next fortnight");
const slot = firstOpen.slots[0]!;
console.log("booking", formatFullStamp(slot, settings.timeZone));

const result = await createBooking({
  eventTypeId: eventType.id,
  startAt: slot,
  guestName: "smoke test",
  guestEmail: "smoke@example.com",
  guestTimeZone: "Europe/Berlin",
  notes: "automated smoke test — safe to delete",
});
if (!result.ok) throw new Error(`booking failed: ${result.reason}`);
console.log("ok, token:", result.booking.cancelToken);

// The slot must now be gone from availability.
const after = await availabilityFor(eventType, today, addDaysToDateKey(today, 14));
const stillOffered = after.days.some((d) => d.slots.includes(slot));
console.log("slot still offered after booking:", stillOffered, stillOffered ? "  <-- BUG" : "(correct)");

// Booking the same slot again must be refused.
const dupe = await createBooking({
  eventTypeId: eventType.id,
  startAt: slot,
  guestName: "smoke test 2",
  guestEmail: "smoke2@example.com",
  guestTimeZone: "UTC",
  notes: null,
});
console.log("double-book refused:", !dupe.ok, dupe.ok ? "  <-- BUG" : `("${dupe.reason}")`);

const readBack = await getBookingByCancelToken(result.booking.cancelToken);
console.log("read back by token:", readBack?.guestName, readBack?.status);
console.log("TOKEN_FOR_CURL=" + result.booking.cancelToken);

// Hard delete rather than cancel: a cancelled row would linger in the admin
// list forever, and this one was never real.
if (!process.argv.includes("--keep")) {
  await db.execute({
    sql: "DELETE FROM coffee_bookings WHERE id = ?",
    args: [result.booking.id],
  });
  console.log("cleaned up. pass --keep to leave the booking in place.");
}
