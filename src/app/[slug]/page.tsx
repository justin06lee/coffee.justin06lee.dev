import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Callout } from "@/components/chrome/callout";
import { SiteHeader } from "@/components/site-header";
import { BookingFlow } from "@/components/booking-flow";
import { getEventTypeBySlug } from "@/lib/event-types";
import { bookingPageData } from "@/lib/page-data";

// Slot availability is the whole point of the page and changes with every
// booking, so nothing here may be cached.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

// The lookup here doesn't share a memo with the page body's batched read, so
// titling the tab costs one extra small round trip. That's the right trade:
// making metadata wait on the whole page load would serialise the render.
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
  // The whole horizon comes back at once and is grouped client-side. Slots are
  // absolute instants, so switching the displayed zone is pure formatting —
  // no round trip, and no chance of the day boundaries disagreeing with the
  // times inside them.
  const { eventType, settings, slots } = await bookingPageData(slug);
  if (!eventType || !eventType.active) notFound();

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
              location: eventType.locationDetail || eventType.location,
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
