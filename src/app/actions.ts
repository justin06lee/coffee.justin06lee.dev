"use server";

import { redirect } from "next/navigation";
import { checkBookingRate } from "@/lib/auth";
import { currentClientIp } from "@/lib/auth-server";
import { cancelByCancelToken, createBooking } from "@/lib/bookings";
import { isValidTimeZone } from "@/lib/time";

/** Guest-supplied strings are bounded here, before anything reaches the database. */
const LIMITS = {
  name: 100,
  email: 200,
  notes: 2000,
} as const;

// Deliberately loose. Anything stricter rejects addresses that are perfectly
// valid — the real check is whether the invite arrives, which no regex knows.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The ECMAScript time-value range. `Number.isFinite` alone lets 1e20 through,
// and the first thing the booking path does with a start is read its host-zone
// date key — `Intl` throws `RangeError: Invalid time value` on anything outside
// this, which surfaces as a 500 rather than a form error.
const MAX_TIME_VALUE = 8.64e15;

export type BookFormState = {
  error: string | null;
};

/**
 * Commit a booking from the public form.
 *
 * Everything the client sends is treated as a hint: the event type is looked
 * up fresh, the slot is re-derived from the availability rules, and the
 * redirect target is the cancel token rather than the row id, so the
 * confirmation page is only reachable by someone who actually booked.
 */
export async function bookSlot(
  _prev: BookFormState,
  formData: FormData,
): Promise<BookFormState> {
  const ip = await currentClientIp();
  if (!(await checkBookingRate(ip))) {
    return { error: "too many booking attempts. try again in an hour." };
  }

  const eventTypeId = String(formData.get("eventTypeId") ?? "");
  const startAt = Number(formData.get("startAt"));
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const timeZone = String(formData.get("timeZone") ?? "");

  if (
    !eventTypeId ||
    !Number.isInteger(startAt) ||
    Math.abs(startAt) > MAX_TIME_VALUE
  ) {
    return { error: "something went wrong with that slot. reload and try again." };
  }
  if (name.length === 0) return { error: "your name, please." };
  if (name.length > LIMITS.name) return { error: "that name is too long." };
  if (!EMAIL.test(email)) return { error: "that doesn't look like an email address." };
  if (email.length > LIMITS.email) return { error: "that email is too long." };
  if (notes.length > LIMITS.notes) return { error: "that note is too long." };

  const result = await createBooking({
    eventTypeId,
    startAt,
    guestName: name,
    guestEmail: email,
    guestTimeZone: isValidTimeZone(timeZone) ? timeZone : "UTC",
    notes: notes || null,
  });

  if (!result.ok) return { error: result.reason };

  // redirect() throws, so it must sit outside any try/catch above it.
  redirect(`/booked/${result.booking.cancelToken}`);
}

// `fetchSlots`/`fetchHorizon` used to live here. They had no callers — the
// booking page computes the whole horizon server-side and hands it to
// <BookingFlow> as a prop — but a "use server" export is not dead code: Next
// compiles every one into a POST endpoint with a stable action id that anyone
// can call. Their date keys went unvalidated into `slotsForRange`, so
// `fetchSlots(id, "0001-01-01", "9999-12-31")` walked ~2.96M days of Intl
// formatting on one request, and a malformed key threw out of `parseDateKey`
// as a 500. Deleting them removes the endpoint rather than validating an
// entry point nothing uses.

export type CancelState = { error: string | null; done: boolean };

export async function cancelByToken(
  _prev: CancelState,
  formData: FormData,
): Promise<CancelState> {
  const token = String(formData.get("token") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  // Cancel tokens are UUIDs, so guessing one is not the worry — an unmetered
  // lookup endpoint is. Without this, the action is a free, unauthenticated
  // database round trip per request. Reuses the booking bucket rather than
  // adding a table: both are "a stranger touching the calendar".
  const ip = await currentClientIp();
  if (!(await checkBookingRate(ip))) {
    return { error: "too many attempts. try again in a bit.", done: false };
  }
  if (!token) return { error: "we couldn't find that booking.", done: false };

  // One round trip decides and reports: the write and the read-back ride in a
  // single transaction, so nothing can slip between looking the booking up and
  // cancelling it. "cancelled" covers the already-cancelled case too, which is
  // the same reply the guest got when that was a branch of its own.
  const outcome = await cancelByCancelToken(
    token,
    reason.slice(0, LIMITS.notes) || null,
    Date.now(),
  );

  if (outcome === "not-found") {
    return { error: "we couldn't find that booking.", done: false };
  }
  if (outcome === "past") {
    return { error: "that meeting has already happened.", done: false };
  }
  return { error: null, done: true };
}
