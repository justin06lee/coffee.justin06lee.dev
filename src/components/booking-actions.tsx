"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { cancelByToken, type CancelState } from "@/app/actions";
import { AddToCalendar } from "@/components/chrome/add-to-calendar";
import { Button } from "@/components/chrome/button";
import { Callout } from "@/components/chrome/callout";
import { Field } from "@/components/chrome/field";
import { Textarea } from "@/components/chrome/textarea";

export type BookingActionsProps = {
  token: string;
  past: boolean;
  event: {
    title: string;
    start: number;
    end: number;
    description: string;
    location: string;
    uid: string;
  };
};

/**
 * Add-to-calendar plus the cancel path, for a booking that is still live.
 *
 * The cancel form is behind a confirm step rather than a bare button: this
 * page is reachable from an emailed link, and a stray tap shouldn't drop a
 * meeting. The .ics is served from the route handler rather than the
 * component's generated blob so the UID matches whatever was already sent.
 */
export function BookingActions({ token, past, event }: BookingActionsProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [state, formAction, pending] = useActionState<CancelState, FormData>(
    cancelByToken,
    { error: null, done: false },
  );

  if (state.done) {
    return (
      <div className="mt-6 flex flex-col gap-4">
        <Callout variant="success" title="cancelled">
          the slot is back on the calendar for someone else.
        </Callout>
        <Button variant="outline" onClick={() => router.refresh()}>
          reload this page
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      {!past ? (
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">
            put it on your calendar
          </span>
          <AddToCalendar
            event={event}
            icsHref={`/api/ics/${token}`}
            targets={["google", "outlook", "office", "ics"]}
          />
        </div>
      ) : null}

      {!past ? (
        <div className="border-t border-white/10 pt-6">
          {!confirming ? (
            <Button variant="ghost" onClick={() => setConfirming(true)}>
              cancel this booking
            </Button>
          ) : (
            <form action={formAction} className="flex flex-col gap-4">
              <input type="hidden" name="token" value={token} />
              <Field label="cancelling — anything to say?" optional>
                {(props) => (
                  <Textarea
                    {...props}
                    name="reason"
                    rows={2}
                    placeholder="something came up"
                  />
                )}
              </Field>
              {state.error ? (
                <Callout variant="danger" title="couldn't cancel">
                  {state.error}
                </Callout>
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" variant="outline" disabled={pending}>
                  {pending ? "cancelling…" : "yes, cancel it"}
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  keep it
                </Button>
              </div>
            </form>
          )}
        </div>
      ) : null}
    </div>
  );
}
