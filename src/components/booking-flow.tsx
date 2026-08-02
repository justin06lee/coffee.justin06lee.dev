"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { Clock, MapPin, User } from "lucide-react";
import { bookSlot, type BookFormState } from "@/app/actions";
import { Button } from "@/components/chrome/button";
import { Callout } from "@/components/chrome/callout";
import { DateStrip } from "@/components/chrome/date-strip";
import { DetailList } from "@/components/chrome/detail-list";
import { EmptyState } from "@/components/chrome/empty-state";
import { Field } from "@/components/chrome/field";
import { Input } from "@/components/chrome/input";
import { SlotPicker } from "@/components/chrome/slot-picker";
import { Stepper } from "@/components/chrome/stepper";
import { Textarea } from "@/components/chrome/textarea";
import { TimezoneSelect } from "@/components/chrome/timezone-select";
import {
  dateKeyInTimeZone,
  formatDuration,
  formatFullStamp,
  formatTimeOfDay,
  guessTimeZone,
  parseDateKey,
} from "@/lib/time";

export type BookingFlowEventType = {
  id: string;
  title: string;
  blurb: string | null;
  durationMin: number;
  location: string;
};

export type BookingFlowProps = {
  eventType: BookingFlowEventType;
  hostName: string;
  hostTimeZone: string;
  /** Every bookable start over the horizon, as epoch ms. */
  slots: number[];
};

const STEPS = [
  { label: "day", description: "pick a date" },
  { label: "time", description: "pick a slot" },
  { label: "details", description: "who you are" },
];

const WEEKDAY_SHORT = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

/**
 * The guest-facing booking flow.
 *
 * Slots arrive as absolute instants and are grouped into days *in the zone
 * being displayed*, not the host's. That distinction is the entire reason the
 * grouping happens on the client: a 5pm Los Angeles slot is 9am the next day
 * in Tokyo, and a Tokyo guest should find it under tomorrow. Changing the zone
 * regroups and relabels everything with no server round trip.
 */
export function BookingFlow({
  eventType,
  hostName,
  hostTimeZone,
  slots,
}: BookingFlowProps) {
  // Starts as the host's zone so the server and client render the same markup;
  // the guest's real zone lands in an effect after mount. Guessing during
  // render would read the *server's* zone and mismatch on hydration.
  const [timeZone, setTimeZone] = useState(hostTimeZone);
  const [zoneReady, setZoneReady] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState<BookFormState, FormData>(
    bookSlot,
    { error: null },
  );

  useEffect(() => {
    setTimeZone(guessTimeZone());
    setZoneReady(true);
  }, []);

  // Days in the displayed zone, each holding the instants that fall on it.
  const days = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const slot of slots) {
      const key = dateKeyInTimeZone(slot, timeZone);
      const list = map.get(key);
      if (list) list.push(slot);
      else map.set(key, [slot]);
    }
    return [...map.entries()]
      .map(([date, instants]) => ({ date, slots: instants.sort((a, b) => a - b) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [slots, timeZone]);

  // Derived rather than stored, for two reasons. It renders the first open
  // day's slots on the server instead of after an effect, so the page arrives
  // with times in it. And regrouping can strip the chosen day out from under
  // the selection — the guest switched zones and "august 5" no longer holds
  // anything — which a stored value would leave pointing at an empty column.
  //
  // A picked slot wins: it's an absolute instant, so it survives a zone change
  // intact, but the day it belongs to may have moved, and the strip has to
  // follow it there.
  const activeDateKey = useMemo(() => {
    if (selectedSlot !== null) return dateKeyInTimeZone(Number(selectedSlot), timeZone);
    if (selectedDate && days.some((d) => d.date === selectedDate)) return selectedDate;
    return days[0]?.date ?? null;
  }, [selectedSlot, selectedDate, days, timeZone]);

  const activeDay = days.find((d) => d.date === activeDateKey) ?? null;

  const stripDays = days.map((day) => {
    const { year, month, day: dayOfMonth } = parseDateKey(day.date);
    const weekday = new Date(Date.UTC(year, month - 1, dayOfMonth)).getUTCDay();
    return {
      value: day.date,
      label: String(dayOfMonth),
      weekday: WEEKDAY_SHORT[weekday],
      count: day.slots.length,
    };
  });

  const step = selectedSlot !== null ? 2 : activeDay ? 1 : 0;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">
            {hostName}
          </p>
          <h1 className="mt-1 text-2xl tracking-tight sm:text-3xl">{eventType.title}</h1>
          {eventType.blurb ? (
            <p className="mt-2 max-w-lg text-[15px] leading-7 text-white/55">
              {eventType.blurb}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-white/50">
          <span className="flex items-center gap-1.5">
            <Clock aria-hidden className="size-3.5" strokeWidth={1.5} />
            {formatDuration(eventType.durationMin)}
          </span>
          <span className="flex items-center gap-1.5">
            <MapPin aria-hidden className="size-3.5" strokeWidth={1.5} />
            {eventType.location}
          </span>
        </div>
      </header>

      <Stepper steps={STEPS} current={step} className="max-w-lg" />

      {days.length === 0 ? (
        <EmptyState
          title="no openings in the next few weeks"
          description="every slot on the calendar is either taken or outside the hours i keep. try again in a little while."
        />
      ) : (
        <>
          <TimezoneSelect
            label="times shown in"
            value={timeZone}
            onChange={setTimeZone}
            className="max-w-xs"
          />

          <DateStrip
            label="pick a day"
            days={stripDays}
            value={activeDateKey}
            onChange={(date) => {
              setSelectedDate(date);
              setSelectedSlot(null);
            }}
          />

          {activeDay ? (
            <SlotPicker
              label={longDayLabel(activeDay.slots[0], timeZone)}
              slots={activeDay.slots.map((instant) => ({
                value: String(instant),
                label: formatTimeOfDay(instant, timeZone),
              }))}
              value={selectedSlot}
              onChange={setSelectedSlot}
              columns={3}
              footnote={
                zoneReady
                  ? `${eventType.durationMin} minutes, ${timeZone.replace(/_/g, " ").toLowerCase()}`
                  : undefined
              }
            />
          ) : null}
        </>
      )}

      {selectedSlot !== null ? (
        <form action={formAction} className="flex flex-col gap-5 border-t border-white/10 pt-8">
          <input type="hidden" name="eventTypeId" value={eventType.id} />
          <input type="hidden" name="startAt" value={selectedSlot} />
          <input type="hidden" name="timeZone" value={timeZone} />

          <DetailList
            items={[
              {
                label: "what",
                value: eventType.title,
                icon: <User className="size-3.5" strokeWidth={1.5} />,
              },
              {
                label: "when",
                value: formatFullStamp(Number(selectedSlot), timeZone),
                icon: <Clock className="size-3.5" strokeWidth={1.5} />,
                note: formatDuration(eventType.durationMin),
              },
              {
                label: "where",
                value: eventType.location,
                icon: <MapPin className="size-3.5" strokeWidth={1.5} />,
              },
            ]}
          />

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="your name" required>
              {(props) => (
                <Input {...props} name="name" autoComplete="name" placeholder="sam rivera" />
              )}
            </Field>

            <Field label="email" required hint="where the invite goes.">
              {(props) => (
                <Input
                  {...props}
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                />
              )}
            </Field>
          </div>

          <Field label="anything i should know?" optional>
            {(props) => (
              <Textarea
                {...props}
                name="notes"
                rows={3}
                placeholder="context, links, a question to start from"
              />
            )}
          </Field>

          {state.error ? (
            <Callout variant="danger" title="that didn't work">
              {state.error}
            </Callout>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="solid" disabled={pending}>
              {pending ? "booking…" : "confirm booking"}
            </Button>
            <Button variant="ghost" onClick={() => setSelectedSlot(null)}>
              pick a different time
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function longDayLabel(instant: number | undefined, timeZone: string): string {
  if (instant === undefined) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  })
    .format(new Date(instant))
    .toLowerCase();
}
