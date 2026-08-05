"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ExternalLink, Mail } from "lucide-react";
import { adminCancelBooking } from "@/app/admin/actions";
import { Badge } from "@/components/chrome/badge";
import { Button } from "@/components/chrome/button";
import { Callout } from "@/components/chrome/callout";
import { Field } from "@/components/chrome/field";
import { Textarea } from "@/components/chrome/textarea";
import type { BookingWithType } from "@/lib/bookings";
import { formatDuration, formatFullStamp } from "@/lib/time";
import { cn } from "@/lib/utils";

/** The shape the server hands over — a booking plus its resolved event type. */
export type BookingListItem = Pick<
  BookingWithType,
  | "id"
  | "startAt"
  | "endAt"
  | "guestName"
  | "guestEmail"
  | "guestTimeZone"
  | "notes"
  | "status"
  | "cancelToken"
  | "cancelReason"
> & { eventType: { title: string } | null };

export type BookingListProps = {
  bookings: BookingListItem[];
  /** Times are shown in the host's zone here — this is the host's own view. */
  hostTimeZone: string;
  /** Show the cancel affordance. Off for the historical list. */
  cancellable?: boolean;
};

export function BookingList({ bookings, hostTimeZone, cancellable = false }: BookingListProps) {
  return (
    <ul className="flex flex-col">
      {bookings.map((booking, index) => (
        <BookingRow
          key={booking.id}
          booking={booking}
          hostTimeZone={hostTimeZone}
          cancellable={cancellable}
          first={index === 0}
        />
      ))}
    </ul>
  );
}

function BookingRow({
  booking,
  hostTimeZone,
  cancellable,
  first,
}: {
  booking: BookingListItem;
  hostTimeZone: string;
  cancellable: boolean;
  first: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, startTransition] = useTransition();

  const cancelled = booking.status === "cancelled";
  const minutes = Math.round((booking.endAt - booking.startAt) / 60_000);

  return (
    <li
      className={cn(
        "flex flex-col gap-3 py-4",
        !first && "border-t border-white/10",
        cancelled && "opacity-50",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className={cn("text-sm text-white", cancelled && "line-through")}>
              {formatFullStamp(booking.startAt, hostTimeZone)}
            </span>
            <Badge>{booking.eventType?.title ?? "deleted type"}</Badge>
            <Badge>{formatDuration(minutes)}</Badge>
            {cancelled ? (
              <Badge className="border-red-400/60 text-red-300">cancelled</Badge>
            ) : null}
          </span>

          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-white/50">
            <span className="text-white/70">{booking.guestName}</span>
            {/* The address is guest-supplied and the booking regex allows
                `?` and `&`, so pasting it raw would let someone register
                `x@evil.com?bcc=…` and pick the headers of the compose window
                the host opens. Encoding kills the query string; the visible
                text stays the plain address. */}
            <a
              href={`mailto:${encodeURIComponent(booking.guestEmail)}`}
              className="flex items-center gap-1 transition-colors hover:text-white"
            >
              <Mail aria-hidden className="size-3" strokeWidth={1.5} />
              {booking.guestEmail}
            </a>
            <span className="text-white/30">
              {booking.guestTimeZone.replace(/_/g, " ").toLowerCase()}
            </span>
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {/* `label` is only read for icon-only buttons, so on a button with
              text it was dropped and every row announced a bare "view". The
              name has to come from the children instead — the guest's name is
              what tells the rows apart. `linkComponent` keeps the hop
              client-side; without it the button falls back to a plain <a>. */}
          <Button
            size="sm"
            variant="ghost"
            href={`/booked/${booking.cancelToken}`}
            linkComponent={Link}
            iconRight={ExternalLink}
          >
            view{" "}
            <span className="sr-only">{booking.guestName}&apos;s booking</span>
          </Button>
          {cancellable && !cancelled ? (
            <Button size="sm" variant="ghost" onClick={() => setConfirming((c) => !c)}>
              cancel
            </Button>
          ) : null}
        </div>
      </div>

      {booking.notes ? (
        <p className="whitespace-pre-wrap border-l border-white/10 pl-3 text-[13px] leading-relaxed text-white/50">
          {booking.notes}
        </p>
      ) : null}

      {cancelled && booking.cancelReason ? (
        <p className="text-[13px] text-white/40">reason: {booking.cancelReason}</p>
      ) : null}

      {confirming && !cancelled ? (
        <div className="flex flex-col gap-3 border border-white/10 p-4">
          <Callout variant="warn" title="cancel this booking?">
            the slot goes back on the calendar. {booking.guestName} is not notified —
            there&apos;s no mail on this site, so tell them yourself.
          </Callout>
          <Field label="reason" optional>
            {(props) => (
              <Textarea
                {...props}
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="shown to them on their booking page"
              />
            )}
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await adminCancelBooking(booking.id, reason);
                  setConfirming(false);
                  // The panel is reopened from the same state, so a reason
                  // left behind would come back pre-filled on the next
                  // booking the host looks at.
                  setReason("");
                })
              }
            >
              {pending ? "cancelling…" : "yes, cancel"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              keep it
            </Button>
          </div>
        </div>
      ) : null}

      {/* The cancel round trip only shows itself as a word on a button and,
          once the page revalidates, a struck-through row — neither of which a
          screen reader announces. This sits outside the confirm panel so it
          outlives it and can still report the outcome. */}
      <span aria-live="polite" role="status" className="sr-only">
        {pending ? "cancelling…" : cancelled ? "booking cancelled." : ""}
      </span>
    </li>
  );
}
