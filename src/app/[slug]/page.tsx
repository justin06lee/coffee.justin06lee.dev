import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Callout } from "@/components/chrome/callout";
import { SiteHeader } from "@/components/site-header";
import { BookingFlow } from "@/components/booking-flow";
import { availabilityFor } from "@/lib/bookings";
import { getEventTypeBySlug } from "@/lib/event-types";
import { getSettings } from "@/lib/settings";
import { addDaysToDateKey, dateKeyInTimeZone } from "@/lib/time";

// Slot availability is the whole point of the page and changes with every
// booking, so nothing here may be cached.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const eventType = await getEventTypeBySlug(slug);
  if (!eventType) return { title: "not found" };
  return {
    title: eventType.title,
    description: eventType.blurb ?? undefined,
  };
}

export default async function BookingPage({ params }: Props) {
  const { slug } = await params;
  const eventType = await getEventTypeBySlug(slug);
  if (!eventType || !eventType.active) notFound();

  const settings = await getSettings();

  // The whole horizon is fetched at once and grouped client-side. Slots are
  // absolute instants, so switching the displayed zone is pure formatting —
  // no round trip, and no chance of the day boundaries disagreeing with the
  // times inside them.
  const today = dateKeyInTimeZone(Date.now(), settings.timeZone);
  const { days } = await availabilityFor(
    eventType,
    today,
    addDaysToDateKey(today, eventType.maxDaysAhead),
  );
  const slots = days.flatMap((d) => d.slots);

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader trail={[{ label: eventType.title }]} />

      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10 sm:px-8 sm:py-14">
        {!settings.bookingsOpen ? (
          <Callout variant="warn" title="not taking bookings right now">
            {settings.closedMessage}
          </Callout>
        ) : (
          <BookingFlow
            eventType={{
              id: eventType.id,
              title: eventType.title,
              blurb: eventType.blurb,
              durationMin: eventType.durationMin,
              // Falls back to the host default, not to the coarse `location`
              // category — see the note on the confirmation page.
              location: eventType.locationDetail || settings.defaultLocation,
            }}
            hostName={settings.hostName}
            hostTimeZone={settings.timeZone}
            slots={slots}
          />
        )}
      </main>
    </div>
  );
}
