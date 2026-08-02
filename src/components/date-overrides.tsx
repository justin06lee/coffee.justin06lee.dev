"use client";

import { useState, useTransition } from "react";
import { CalendarOff, Trash2 } from "lucide-react";
import { addDateOverride, removeDateOverride } from "@/app/admin/actions";
import { Button } from "@/components/chrome/button";
import { EmptyState } from "@/components/chrome/empty-state";
import { Field } from "@/components/chrome/field";
import { Input } from "@/components/chrome/input";
import { RadioGroup } from "@/components/chrome/radio-group";
import { formatMinutes, parseDateKey } from "@/lib/time";

export type OverrideItem = {
  id: string;
  date: string;
  blocked: boolean;
  startMin: number | null;
  endMin: number | null;
  note: string | null;
};

export type DateOverridesProps = {
  overrides: OverrideItem[];
  /** Today in the host's zone — the earliest date worth overriding. */
  today: string;
};

export function DateOverrides({ overrides, today }: DateOverridesProps) {
  const [kind, setKind] = useState<"blocked" | "custom">("blocked");
  const [startTime, setStartTime] = useState("14:00");
  const [endTime, setEndTime] = useState("17:00");
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-6">
      <form
        action={(formData) => startTransition(() => addDateOverride(formData))}
        className="flex flex-col gap-4 border border-white/10 p-5"
      >
        <RadioGroup
          label="kind"
          orientation="horizontal"
          value={kind}
          onChange={(next) => setKind(next)}
          options={[
            { value: "blocked" as const, label: "block the whole day" },
            { value: "custom" as const, label: "different hours" },
          ]}
        />
        <input type="hidden" name="kind" value={kind} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="date" required>
            {(props) => <Input {...props} name="date" type="date" min={today} />}
          </Field>

          {kind === "custom" ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="from" required>
                {(props) => (
                  <Input
                    {...props}
                    type="time"
                    step={900}
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                )}
              </Field>
              <Field label="to" required>
                {(props) => (
                  <Input
                    {...props}
                    type="time"
                    step={900}
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                )}
              </Field>
            </div>
          ) : null}
        </div>

        <Field label="note" optional hint="just for you — guests never see it.">
          {(props) => <Input {...props} name="note" placeholder="flying" />}
        </Field>

        {/* The action's contract is numeric — minutes past midnight — while
            the inputs above speak "HH:MM". Converting here keeps the parsing
            out of the action, which never has to trust a time string. */}
        <input type="hidden" name="startMin" value={toMinutes(startTime)} />
        <input type="hidden" name="endMin" value={toMinutes(endTime)} />

        <div>
          <Button type="submit" variant="outline" disabled={pending}>
            {pending ? "adding…" : "add override"}
          </Button>
        </div>
      </form>

      {overrides.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<CalendarOff className="size-6" strokeWidth={1} />}
          title="no date overrides"
          description="the weekly hours apply to every upcoming day."
        />
      ) : (
        <ul className="flex flex-col">
          {overrides.map((override, index) => (
            <li
              key={override.id}
              className={`flex items-center justify-between gap-4 py-3 ${
                index > 0 ? "border-t border-white/10" : ""
              }`}
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm text-white">{longDate(override.date)}</span>
                <span className="text-[13px] text-white/45">
                  {override.blocked
                    ? "blocked all day"
                    : `${formatMinutes(override.startMin ?? 0)}–${formatMinutes(
                        override.endMin ?? 0,
                      )}`}
                  {override.note ? ` · ${override.note}` : ""}
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                icon={Trash2}
                label={`remove the override on ${override.date}`}
                disabled={pending}
                onClick={() => startTransition(() => removeDateOverride(override.id))}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function toMinutes(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function longDate(dateKey: string): string {
  const { year, month, day } = parseDateKey(dateKey);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })
    .format(new Date(Date.UTC(year, month - 1, day)))
    .toLowerCase();
}
