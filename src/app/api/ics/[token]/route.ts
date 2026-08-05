import { bookingRecord } from "@/lib/page-data";
import { buildIcs } from "@/lib/ics";

export const dynamic = "force-dynamic";

/**
 * The canonical .ics for a booking, keyed by its cancel token.
 *
 * Served from the server rather than generated in the browser so the UID and
 * SEQUENCE are stable: re-downloading updates the event already in someone's
 * calendar instead of adding a second copy, and a cancelled booking emits a
 * CANCEL that withdraws it.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  const { booking, eventType, settings } = await bookingRecord(token);
  if (!booking) {
    return new Response("not found", { status: 404 });
  }

  const title = eventType?.title ?? "meeting";
  // Same chain as the confirmation page, and for the same reason: the coarse
  // `location` category always has a value, so including it put the literal
  // word "video" in the invite instead of the host's default.
  const location = eventType?.locationDetail || settings.defaultLocation;

  const ics = buildIcs({
    uid: `${booking.id}@coffee.justin06lee.dev`,
    start: booking.startAt,
    end: booking.endAt,
    title: `${title} with ${settings.hostName}`,
    description: booking.notes
      ? `${eventType?.blurb ?? ""}\n\nnote from ${booking.guestName}: ${booking.notes}`.trim()
      : (eventType?.blurb ?? ""),
    location,
    organizerName: settings.hostName,
    attendeeName: booking.guestName,
    attendeeEmail: booking.guestEmail,
    cancelled: booking.status === "cancelled",
  });

  return new Response(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="${title.replace(/[^a-z0-9]+/gi, "-")}.ics"`,
      // The token is a capability; a shared cache must never hold the response.
      "cache-control": "private, no-store",
    },
  });
}
