"use server";

import { redirect } from "next/navigation";
import { checkBookingRate } from "@/lib/auth";
import { currentClientIp } from "@/lib/auth-server";
import { availabilityFor, cancelByCancelToken, createBooking } from "@/lib/bookings";
import { getEventType } from "@/lib/event-types";
import { addDaysToDateKey, dateKeyInTimeZone, isValidTimeZone } from "@/lib/time";
import { getSettings } from "@/lib/settings";

/** Guest-supplied strings are bounded here, before anything reaches the database. */
const LIMITS = {
  name: 100,
  email: 200,
  notes: 2000,
} as const;

// Deliberately loose. Anything stricter rejects addresses that are perfectly
// valid — the real check is whether the invite arrives, which no regex knows.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  if (!eventTypeId || !Number.isFinite(startAt)) {
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

/** Slots for a window, as absolute instants. The client groups them by the zone it's showing. */
export async function fetchSlots(
  eventTypeId: string,
  fromDateKey: string,
  toDateKey: string,
): Promise<number[]> {
  const eventType = await getEventType(eventTypeId);
  if (!eventType || !eventType.active) return [];
  const { days } = await availabilityFor(eventType, fromDateKey, toDateKey);
  return days.flatMap((d) => d.slots);
}

/** The full bookable horizon for an event type, from today in the host's zone. */
export async function fetchHorizon(eventTypeId: string): Promise<number[]> {
  const eventType = await getEventType(eventTypeId);
  if (!eventType || !eventType.active) return [];

  // The window is derived here and the availability read made directly, rather
  // than handing the ids back to `fetchSlots` — which would look the same event
  // type up a second time to rebuild what this function already has.
  const settings = await getSettings();
  const today = dateKeyInTimeZone(Date.now(), settings.timeZone);
  const { days } = await availabilityFor(
    eventType,
    today,
    addDaysToDateKey(today, eventType.maxDaysAhead),
  );
  return days.flatMap((d) => d.slots);
}

export type CancelState = { error: string | null; done: boolean };

export async function cancelByToken(
  _prev: CancelState,
  formData: FormData,
): Promise<CancelState> {
  const token = String(formData.get("token") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

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
