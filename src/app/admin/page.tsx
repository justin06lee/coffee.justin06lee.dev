import { CalendarCheck, CalendarX, CalendarDays, Users } from "lucide-react";
import { EmptyState } from "@/components/chrome/empty-state";
import { StatTile } from "@/components/chrome/stat-tile";
import { BookingList } from "@/components/booking-list";
import { adminOverview } from "@/lib/page-data";

export const dynamic = "force-dynamic";

export default async function AdminBookingsPage() {
  const now = Date.now();
  const { stats, upcoming, recent, settings } = await adminOverview(now);

  return (
    <div className="flex flex-col gap-10">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="upcoming"
          value={stats.upcoming}
          icon={<CalendarCheck className="size-3.5" strokeWidth={1.5} />}
        />
        <StatTile
          label="next 7 days"
          value={stats.thisWeek}
          icon={<CalendarDays className="size-3.5" strokeWidth={1.5} />}
        />
        <StatTile
          label="cancelled"
          value={stats.cancelled}
          icon={<CalendarX className="size-3.5" strokeWidth={1.5} />}
        />
        <StatTile
          label="all time"
          value={stats.total}
          icon={<Users className="size-3.5" strokeWidth={1.5} />}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">
          upcoming
        </h2>
        {upcoming.length === 0 ? (
          <EmptyState
            title="nothing booked"
            description="when someone takes a slot it shows up here."
            size="sm"
          />
        ) : (
          <BookingList bookings={upcoming} hostTimeZone={settings.timeZone} cancellable />
        )}
      </section>

      {recent.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">
            last fortnight
          </h2>
          <BookingList bookings={recent} hostTimeZone={settings.timeZone} />
        </section>
      ) : null}
    </div>
  );
}
