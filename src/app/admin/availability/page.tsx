import { AvailabilityEditor } from "@/components/availability-editor";
import { DateOverrides } from "@/components/date-overrides";
import { HostSettingsForm } from "@/components/host-settings-form";
import { listOverrides, listRules } from "@/lib/schedule";
import { getSettings } from "@/lib/settings";
import { dateKeyInTimeZone } from "@/lib/time";

export const dynamic = "force-dynamic";

export const metadata = { title: "availability" };

export default async function AvailabilityPage() {
  const settings = await getSettings();
  const today = dateKeyInTimeZone(Date.now(), settings.timeZone);

  const [rules, overrides] = await Promise.all([
    listRules(),
    // Past overrides are noise — they can't affect any bookable day.
    listOverrides({ from: today }),
  ]);

  return (
    <div className="flex flex-col gap-12">
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg">weekly hours</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-white/45">
            in {settings.timeZone.replace(/_/g, " ").toLowerCase()}. these repeat every week;
            a specific date can override them below.
          </p>
        </div>
        <AvailabilityEditor
          initialRules={rules.map((r) => ({
            weekday: r.weekday,
            startMin: r.startMin,
            endMin: r.endMin,
          }))}
        />
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg">specific dates</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-white/45">
            block a day off, or replace its hours for once. an override wins over the
            weekly rule for that date entirely.
          </p>
        </div>
        <DateOverrides
          overrides={overrides.map((o) => ({
            id: o.id,
            date: o.date,
            blocked: o.blocked,
            startMin: o.startMin,
            endMin: o.endMin,
            note: o.note,
          }))}
          today={today}
        />
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg">host settings</h2>
          <p className="mt-1 text-[13px] leading-relaxed text-white/45">
            your name, your zone, and the switch that closes the calendar.
          </p>
        </div>
        <HostSettingsForm settings={settings} />
      </section>
    </div>
  );
}
