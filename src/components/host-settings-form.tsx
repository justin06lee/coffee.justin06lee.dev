"use client";

import { useState, useTransition } from "react";
import { saveHostSettings } from "@/app/admin/actions";
import { Button } from "@/components/chrome/button";
import { Field } from "@/components/chrome/field";
import { Input } from "@/components/chrome/input";
import { Switch } from "@/components/chrome/switch";
import { Textarea } from "@/components/chrome/textarea";
import { TimezoneSelect } from "@/components/chrome/timezone-select";
import type { Settings } from "@/lib/settings";

export function HostSettingsForm({ settings }: { settings: Settings }) {
  const [timeZone, setTimeZone] = useState(settings.timeZone);
  const [open, setOpen] = useState(settings.bookingsOpen);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          await saveHostSettings(formData);
          setSaved(true);
        })
      }
      onChange={() => setSaved(false)}
      className="flex flex-col gap-5 border border-white/10 p-5"
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="your name" required>
          {(props) => <Input {...props} name="hostName" defaultValue={settings.hostName} />}
        </Field>

        <Field label="default location" hint="used when a meeting type doesn't set its own.">
          {(props) => (
            <Input {...props} name="defaultLocation" defaultValue={settings.defaultLocation} />
          )}
        </Field>
      </div>

      <Field label="bio" optional hint="one line under your name on the landing page.">
        {(props) => <Textarea {...props} name="hostBio" rows={2} defaultValue={settings.hostBio} />}
      </Field>

      <div className="flex flex-col gap-2">
        <TimezoneSelect
          label="your time zone"
          value={timeZone}
          onChange={(zone) => {
            setTimeZone(zone);
            setSaved(false);
          }}
          className="max-w-xs"
        />
        <input type="hidden" name="timeZone" value={timeZone} />
        <p className="text-[13px] leading-relaxed text-white/40">
          every weekly window is read in this zone. changing it moves your whole
          schedule — existing bookings keep the absolute time they were made for.
        </p>
      </div>

      <div className="flex flex-col gap-4 border-t border-white/10 pt-5">
        <Switch
          checked={open}
          onChange={(next) => {
            setOpen(next);
            setSaved(false);
          }}
          labelPosition="start"
          label="bookings open"
          description="off hides every picker without touching your hours or history."
        />
        {/* A React-controlled Switch isn't a form control, so the input below
            is what actually reaches the action. It carries the flag as a value
            rather than as a hidden checkbox: React resets any form with a
            function action after every submit, and a checkbox's defaultChecked
            is captured once at mount and never re-synced, so the reset would
            snap the DOM back to the value the page loaded with while the Switch
            still showed the new one — and the next save would silently reopen
            bookings the host had just closed. A hidden input's default is
            re-synced on every render, so it survives the reset. */}
        <input type="hidden" name="bookingsOpen" value={open ? "1" : "0"} />

        {!open ? (
          <Field label="closed message" hint="shown in place of the picker.">
            {(props) => (
              <Textarea
                {...props}
                name="closedMessage"
                rows={2}
                defaultValue={settings.closedMessage}
              />
            )}
          </Field>
        ) : (
          <input type="hidden" name="closedMessage" value={settings.closedMessage} />
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" variant="solid" disabled={pending}>
          {pending ? "saving…" : "save settings"}
        </Button>
        <span aria-live="polite" role="status" className="text-[13px] text-white/40">
          {saved ? "saved." : ""}
        </span>
      </div>
    </form>
  );
}
