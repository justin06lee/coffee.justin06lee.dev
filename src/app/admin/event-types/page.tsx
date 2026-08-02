import { EventTypeManager } from "@/components/event-type-manager";
import { listEventTypes } from "@/lib/event-types";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export const metadata = { title: "meeting types" };

export default async function EventTypesPage() {
  const [eventTypes, settings] = await Promise.all([
    listEventTypes({ includeInactive: true }),
    getSettings(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg">meeting types</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-white/45">
          each one gets its own page at coffee.justin06lee.dev/&lt;slug&gt;. hidden types
          keep their bookings but disappear from the landing page.
        </p>
      </div>

      <EventTypeManager eventTypes={eventTypes} defaultLocation={settings.defaultLocation} />
    </div>
  );
}
