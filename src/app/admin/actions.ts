"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  SESSION_COOKIE_NAME,
  checkLoginRate,
  createSession,
  destroySession,
  verifyAdminKey,
} from "@/lib/auth";
import { currentClientIp, requireAdmin } from "@/lib/auth-server";
import { cancelBooking } from "@/lib/bookings";
import {
  createEventType,
  deleteEventType,
  slugify,
  updateEventType,
  type EventTypeInput,
} from "@/lib/event-types";
import { addOverride, blockDate, deleteOverride, replaceRules } from "@/lib/schedule";
import { saveSettings } from "@/lib/settings";
import { isValidDateKey, isValidTimeZone } from "@/lib/time";
import type { Weekday } from "@/lib/time";

export type LoginResult = { error: string | null; rateLimited?: boolean };

export async function login(password: string): Promise<LoginResult> {
  const ip = await currentClientIp();
  if (!(await checkLoginRate(ip))) {
    return { error: "too many attempts. try again later.", rateLimited: true };
  }
  if (!verifyAdminKey(password)) {
    // Deliberately generic: a specific message would confirm which half of the
    // guess was right.
    return { error: "that's not it." };
  }

  const token = await createSession();
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 24 * 60 * 60,
  });
  return { error: null };
}

export async function logout(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (token) await destroySession(token);
  store.delete(SESSION_COOKIE_NAME);
  redirect("/login");
}

/* ── availability ── */

export type WeeklyRuleInput = { weekday: number; startMin: number; endMin: number };

export async function saveWeeklyRules(rules: WeeklyRuleInput[]): Promise<void> {
  await requireAdmin();

  // The editor is trusted to be well-formed, but it isn't the only possible
  // caller of a server action. Anything malformed is dropped rather than
  // stored, since a bad window would silently distort every slot query.
  const clean = rules
    .filter(
      (r) =>
        Number.isInteger(r.weekday) &&
        r.weekday >= 0 &&
        r.weekday <= 6 &&
        Number.isFinite(r.startMin) &&
        Number.isFinite(r.endMin) &&
        r.startMin >= 0 &&
        r.endMin <= 24 * 60 &&
        r.endMin > r.startMin,
    )
    .map((r) => ({
      weekday: r.weekday as Weekday,
      startMin: Math.round(r.startMin),
      endMin: Math.round(r.endMin),
    }));

  await replaceRules(clean);
  revalidatePath("/", "layout");
}

export async function addDateOverride(formData: FormData): Promise<void> {
  await requireAdmin();
  const date = String(formData.get("date") ?? "");
  if (!isValidDateKey(date)) return;

  const kind = String(formData.get("kind") ?? "blocked");
  const note = String(formData.get("note") ?? "").trim().slice(0, 200) || null;

  if (kind === "blocked") {
    await blockDate(date, note);
  } else {
    const startMin = Number(formData.get("startMin"));
    const endMin = Number(formData.get("endMin"));
    if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || endMin <= startMin) return;
    await addOverride({ date, blocked: false, startMin, endMin, note });
  }
  revalidatePath("/", "layout");
}

export async function removeDateOverride(id: string): Promise<void> {
  await requireAdmin();
  await deleteOverride(id);
  revalidatePath("/", "layout");
}

/* ── settings ── */

export async function saveHostSettings(formData: FormData): Promise<void> {
  await requireAdmin();
  const timeZone = String(formData.get("timeZone") ?? "");

  await saveSettings({
    hostName: String(formData.get("hostName") ?? "").trim().slice(0, 80) || undefined,
    hostBio: String(formData.get("hostBio") ?? "").trim().slice(0, 400),
    defaultLocation:
      String(formData.get("defaultLocation") ?? "").trim().slice(0, 200) || undefined,
    // An unrecognised zone would make every slot computation throw, so it is
    // dropped rather than stored.
    ...(isValidTimeZone(timeZone) ? { timeZone } : {}),
    // "1"/"0" rather than a checkbox's "on": the form sends a hidden input, so
    // the flag is always present and matches how settings stores it.
    bookingsOpen: formData.get("bookingsOpen") === "1",
    closedMessage: String(formData.get("closedMessage") ?? "").trim().slice(0, 300),
  });
  revalidatePath("/", "layout");
}

/* ── event types ── */

function parseEventType(formData: FormData): EventTypeInput | null {
  const text = (key: string) => {
    const raw = formData.get(key);
    return typeof raw === "string" ? raw.trim() : "";
  };

  const title = text("title");
  if (!title) return null;

  const slug = slugify(text("slug") || title);
  if (!slug) return null;

  // A cleared <input type="number"> submits "", and Number("") is 0 — finite,
  // so anything that reaches for the number first clamps a blank field to `min`
  // instead of falling back. Clearing "horizon" to get the default back would
  // have set it to 1 day and collapsed the public page to a single bookable
  // date, so blank has to mean "unanswered" before any arithmetic sees it.
  const int = (key: string, fallback: number, min: number, max: number) => {
    const raw = text(key);
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.round(value)));
  };

  // dailyLimit reads a blank the other way round on purpose: the field is
  // documented as "blank for no cap", so absent means null, not a default.
  const dailyLimitText = text("dailyLimit");
  const dailyLimitRaw = dailyLimitText ? Number(dailyLimitText) : Number.NaN;

  return {
    slug,
    title: title.slice(0, 80),
    blurb: text("blurb").slice(0, 300) || null,
    durationMin: int("durationMin", 30, 5, 8 * 60),
    incrementMin: int("incrementMin", 15, 5, 4 * 60),
    bufferBeforeMin: int("bufferBeforeMin", 0, 0, 4 * 60),
    bufferAfterMin: int("bufferAfterMin", 0, 0, 4 * 60),
    minNoticeMin: int("minNoticeMin", 720, 0, 60 * 24 * 30),
    maxDaysAhead: int("maxDaysAhead", 45, 1, 365),
    dailyLimit:
      Number.isFinite(dailyLimitRaw) && dailyLimitRaw > 0
        ? Math.round(dailyLimitRaw)
        : null,
    location: text("location").slice(0, 40) || "video",
    locationDetail: text("locationDetail").slice(0, 200) || null,
    // Same hidden-input encoding as bookingsOpen — see saveHostSettings.
    active: text("active") === "1",
  };
}

export type EventTypeFormState = { error: string | null };

export async function saveEventType(
  _prev: EventTypeFormState,
  formData: FormData,
): Promise<EventTypeFormState> {
  await requireAdmin();
  const input = parseEventType(formData);
  if (!input) return { error: "a title is required." };

  const id = String(formData.get("id") ?? "");

  try {
    if (id) await updateEventType(id, input);
    else await createEventType(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/UNIQUE constraint failed/i.test(message)) {
      return { error: `the slug "${input.slug}" is already taken.` };
    }
    throw error;
  }

  revalidatePath("/", "layout");
  return { error: null };
}

export async function removeEventType(id: string): Promise<{ error: string | null }> {
  await requireAdmin();
  const result = await deleteEventType(id);
  revalidatePath("/", "layout");
  return { error: result.ok ? null : result.reason };
}

/* ── bookings ── */

export async function adminCancelBooking(id: string, reason: string): Promise<void> {
  await requireAdmin();
  await cancelBooking(id, reason.trim().slice(0, 500) || null);
  revalidatePath("/", "layout");
}
