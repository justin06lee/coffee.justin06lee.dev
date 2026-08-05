import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Calendar, Clock, Mail, MapPin, User } from "lucide-react";
import { Callout } from "@/components/chrome/callout";
import { DetailList } from "@/components/chrome/detail-list";
import { SiteHeader } from "@/components/site-header";
import { BookingActions } from "@/components/booking-actions";
import { bookingRecord } from "@/lib/page-data";
import { formatDuration, formatFullStamp } from "@/lib/time";

export const dynamic = "force-dynamic";

// The token is the capability that grants access to this page; letting a
// crawler index it would leak the booking and its cancel link.
export const metadata: Metadata = {
  title: "your booking",
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ token: string }> };

export default async function BookedPage({ params }: Props) {
  const { token } = await params;
  const { booking, eventType, settings } = await bookingRecord(token);
  if (!booking) notFound();

  const cancelled = booking.status === "cancelled";
  const past = booking.startAt < Date.now();
  const location = eventType?.locationDetail || eventType?.location || settings.defaultLocation;
  const title = eventType?.title ?? "meeting";

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader trail={[{ label: "your booking" }]} />

      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-12 sm:px-8 sm:py-16">
        <h1 className="text-2xl tracking-tight sm:text-3xl">
          {cancelled ? "this booking is cancelled" : past ? "this already happened" : "you're booked"}
        </h1>
        <p className="mt-2 text-[15px] leading-7 text-white/55">
          {cancelled
            ? "nothing is on the calendar for this one anymore."
            : past
              ? "hope it was useful."
              : `see you then. this page is your record — keep the link if you need to cancel.`}
        </p>

        <div className="mt-8 border border-white/10 p-5">
          <DetailList
            items={[
              {
                label: "what",
                value: title,
                icon: <User className="size-3.5" strokeWidth={1.5} />,
              },
              {
                label: "when",
                value: formatFullStamp(booking.startAt, booking.guestTimeZone),
                icon: <Clock className="size-3.5" strokeWidth={1.5} />,
                note: `${formatDuration(
                  Math.round((booking.endAt - booking.startAt) / 60_000),
                )} · ${booking.guestTimeZone.replace(/_/g, " ").toLowerCase()}`,
              },
              {
                label: "host time",
                value: formatFullStamp(booking.startAt, settings.timeZone),
                icon: <Calendar className="size-3.5" strokeWidth={1.5} />,
                note: settings.timeZone.replace(/_/g, " ").toLowerCase(),
              },
              {
                label: "where",
                value: location,
                icon: <MapPin className="size-3.5" strokeWidth={1.5} />,
              },
              {
                label: "you",
                value: booking.guestName,
                icon: <Mail className="size-3.5" strokeWidth={1.5} />,
                note: booking.guestEmail,
              },
            ]}
          />
        </div>

        {booking.notes ? (
          <div className="mt-4 border border-white/10 p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">
              your note
            </p>
            <p className="mt-2 whitespace-pre-wrap text-[15px] leading-7 text-white/70">
              {booking.notes}
            </p>
          </div>
        ) : null}

        {cancelled ? (
          <Callout className="mt-6" variant="note" title="cancelled">
            {booking.cancelReason
              ? `reason given: ${booking.cancelReason}`
              : "no reason was given."}
          </Callout>
        ) : (
          <BookingActions
            token={booking.cancelToken}
            past={past}
            event={{
              title: `${title} with ${settings.hostName}`,
              start: booking.startAt,
              end: booking.endAt,
              description: booking.notes
                ? `${eventType?.blurb ?? ""}\n\nyour note: ${booking.notes}`.trim()
                : (eventType?.blurb ?? ""),
              location,
              uid: `${booking.id}@coffee.justin06lee.dev`,
            }}
          />
        )}
      </main>
    </div>
  );
}
