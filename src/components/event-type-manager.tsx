"use client";

import { useActionState, useState, useTransition, type ChangeEvent } from "react";
import { ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import {
  removeEventType,
  saveEventType,
  type EventTypeFormState,
} from "@/app/admin/actions";
import { Badge } from "@/components/chrome/badge";
import { Button } from "@/components/chrome/button";
import { Callout } from "@/components/chrome/callout";
import { EmptyState } from "@/components/chrome/empty-state";
import { Field } from "@/components/chrome/field";
import { Input } from "@/components/chrome/input";
import { Switch } from "@/components/chrome/switch";
import { Textarea } from "@/components/chrome/textarea";
import type { EventType } from "@/lib/event-types";
import { formatDuration } from "@/lib/time";
import { cn } from "@/lib/utils";

export type EventTypeManagerProps = {
  eventTypes: EventType[];
  defaultLocation: string;
};

export function EventTypeManager({ eventTypes, defaultLocation }: EventTypeManagerProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-6">
      {deleteError ? (
        <Callout variant="danger" title="can't delete that" onDismiss={() => setDeleteError(null)}>
          {deleteError}
        </Callout>
      ) : null}

      {eventTypes.length === 0 && !creating ? (
        <EmptyState
          title="no meeting types"
          description="add one and it gets its own booking page."
          action={
            <Button variant="solid" size="sm" icon={Plus} onClick={() => setCreating(true)}>
              add a type
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col">
          {eventTypes.map((eventType, index) => (
            <li
              key={eventType.id}
              className={cn(
                "flex flex-col gap-4 py-4",
                index > 0 && "border-t border-white/10",
                !eventType.active && "opacity-60",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-white">{eventType.title}</span>
                    <Badge>/{eventType.slug}</Badge>
                    <Badge>{formatDuration(eventType.durationMin)}</Badge>
                    {!eventType.active ? <Badge>hidden</Badge> : null}
                  </span>
                  {eventType.blurb ? (
                    <span className="text-[13px] leading-relaxed text-white/45">
                      {eventType.blurb}
                    </span>
                  ) : null}
                  <span className="font-mono text-[11px] text-white/30">
                    every {eventType.incrementMin}m · {eventType.minNoticeMin / 60}h notice ·{" "}
                    {eventType.maxDaysAhead}d ahead
                    {eventType.bufferBeforeMin > 0 ? ` · ${eventType.bufferBeforeMin}m before` : ""}
                    {eventType.bufferAfterMin > 0 ? ` · +${eventType.bufferAfterMin}m buffer` : ""}
                    {eventType.dailyLimit ? ` · max ${eventType.dailyLimit}/day` : ""}
                  </span>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    href={`/${eventType.slug}`}
                    iconRight={ExternalLink}
                    label="open the booking page"
                  >
                    view
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={Pencil}
                    label={`edit ${eventType.title}`}
                    onClick={() =>
                      setEditing((current) => (current === eventType.id ? null : eventType.id))
                    }
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={Trash2}
                    label={`delete ${eventType.title}`}
                    onClick={() =>
                      setConfirmingDelete((current) =>
                        current === eventType.id ? null : eventType.id,
                      )
                    }
                  />
                </div>
              </div>

              {/* The only thing standing between this icon and data loss used
                  to be deleteEventType refusing types that have bookings — a
                  type nobody has booked yet went on one click with no undo.
                  Same confirm step the cancel flow uses. */}
              {confirmingDelete === eventType.id ? (
                <div className="flex flex-col gap-3 border border-white/10 p-4">
                  <Callout variant="warn" title={`delete ${eventType.title}?`}>
                    the type and its settings go for good and /{eventType.slug} stops
                    resolving. switching it to hidden takes it off the landing page
                    without losing anything.
                  </Callout>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          const result = await removeEventType(eventType.id);
                          setDeleteError(result.error);
                          setConfirmingDelete(null);
                        })
                      }
                    >
                      {pending ? "deleting…" : "yes, delete"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(null)}>
                      keep it
                    </Button>
                  </div>
                </div>
              ) : null}

              {editing === eventType.id ? (
                <EventTypeForm
                  eventType={eventType}
                  defaultLocation={defaultLocation}
                  onDone={() => setEditing(null)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <EventTypeForm defaultLocation={defaultLocation} onDone={() => setCreating(false)} />
      ) : eventTypes.length > 0 ? (
        <div>
          <Button variant="dashed" icon={Plus} onClick={() => setCreating(true)}>
            add a meeting type
          </Button>
        </div>
      ) : null}
    </div>
  );
}

type EventTypeFields = {
  title: string;
  slug: string;
  blurb: string;
  durationMin: string;
  incrementMin: string;
  bufferBeforeMin: string;
  bufferAfterMin: string;
  minNoticeMin: string;
  maxDaysAhead: string;
  dailyLimit: string;
  locationDetail: string;
};

/**
 * Numbers live in state as strings so a field can be genuinely empty — the
 * host has to be able to clear one and get the server's default back rather
 * than be forced through a number that was never theirs.
 *
 * The fallbacks here mirror the ones `parseEventType` applies. If the two ever
 * drift, the form shows one thing and stores another.
 */
function fieldsFor(eventType?: EventType): EventTypeFields {
  return {
    title: eventType?.title ?? "",
    slug: eventType?.slug ?? "",
    blurb: eventType?.blurb ?? "",
    durationMin: String(eventType?.durationMin ?? 30),
    incrementMin: String(eventType?.incrementMin ?? 15),
    bufferBeforeMin: String(eventType?.bufferBeforeMin ?? 0),
    bufferAfterMin: String(eventType?.bufferAfterMin ?? 0),
    minNoticeMin: String(eventType?.minNoticeMin ?? 720),
    maxDaysAhead: String(eventType?.maxDaysAhead ?? 45),
    dailyLimit: eventType?.dailyLimit != null ? String(eventType.dailyLimit) : "",
    locationDetail: eventType?.locationDetail ?? "",
  };
}

function EventTypeForm({
  eventType,
  defaultLocation,
  onDone,
}: {
  eventType?: EventType;
  defaultLocation: string;
  onDone: () => void;
}) {
  // Every field is controlled. React resets a form with a function action after
  // *every* submit, including a rejected one, so with defaultValue a duplicate
  // slug wiped the whole form and left the error hanging over empty inputs —
  // and on the edit path it looked like the change had saved and un-saved
  // itself. State is the only copy the reset can't reach.
  const [fields, setFields] = useState(() => fieldsFor(eventType));
  const [active, setActive] = useState(eventType?.active ?? true);

  const update =
    (key: keyof EventTypeFields) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setFields((current) => ({ ...current, [key]: event.target.value }));

  const [state, formAction, pending] = useActionState<EventTypeFormState, FormData>(
    async (prev, formData) => {
      const result = await saveEventType(prev, formData);
      // Only close on success — an error has to stay on screen next to the
      // field that caused it.
      if (!result.error) {
        // Clearing belongs to the success path now that nothing else clears
        // it. Only the create form: an edit's values are what was just stored,
        // so resetting it would show the host their old row back.
        if (!eventType) {
          setFields(fieldsFor(undefined));
          setActive(true);
        }
        onDone();
      }
      return result;
    },
    { error: null },
  );

  return (
    <form action={formAction} className="flex flex-col gap-5 border border-white/10 p-5">
      {eventType ? <input type="hidden" name="id" value={eventType.id} /> : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="title" required>
          {(props) => (
            <Input {...props} name="title" value={fields.title} onChange={update("title")} />
          )}
        </Field>
        <Field label="slug" hint="left empty, it's made from the title.">
          {(props) => (
            <Input
              {...props}
              name="slug"
              value={fields.slug}
              onChange={update("slug")}
              placeholder="coffee"
            />
          )}
        </Field>
      </div>

      <Field label="blurb" optional>
        {(props) => (
          <Textarea
            {...props}
            name="blurb"
            rows={2}
            value={fields.blurb}
            onChange={update("blurb")}
          />
        )}
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="length" hint="minutes">
          {(props) => (
            <Input
              {...props}
              name="durationMin"
              type="number"
              min={5}
              max={480}
              value={fields.durationMin}
              onChange={update("durationMin")}
            />
          )}
        </Field>
        <Field label="slots every" hint="minutes">
          {(props) => (
            <Input
              {...props}
              name="incrementMin"
              type="number"
              min={5}
              max={240}
              value={fields.incrementMin}
              onChange={update("incrementMin")}
            />
          )}
        </Field>
      </div>

      {/* "buffer before" is a real field rather than the hidden echo it used to
          be. The availability engine has always honoured it, so a value that
          could only ever be 0 was a setting the host was told they had and
          never did. */}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="buffer before" hint="minutes kept clear">
          {(props) => (
            <Input
              {...props}
              name="bufferBeforeMin"
              type="number"
              min={0}
              max={240}
              value={fields.bufferBeforeMin}
              onChange={update("bufferBeforeMin")}
            />
          )}
        </Field>
        <Field label="buffer after" hint="minutes kept clear">
          {(props) => (
            <Input
              {...props}
              name="bufferAfterMin"
              type="number"
              min={0}
              max={240}
              value={fields.bufferAfterMin}
              onChange={update("bufferAfterMin")}
            />
          )}
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="notice" hint="minutes ahead">
          {(props) => (
            <Input
              {...props}
              name="minNoticeMin"
              type="number"
              min={0}
              value={fields.minNoticeMin}
              onChange={update("minNoticeMin")}
            />
          )}
        </Field>
        <Field label="horizon" hint="days out">
          {(props) => (
            <Input
              {...props}
              name="maxDaysAhead"
              type="number"
              min={1}
              max={365}
              value={fields.maxDaysAhead}
              onChange={update("maxDaysAhead")}
            />
          )}
        </Field>
        <Field label="per day" hint="blank for no cap" optional>
          {(props) => (
            <Input
              {...props}
              name="dailyLimit"
              type="number"
              min={1}
              value={fields.dailyLimit}
              onChange={update("dailyLimit")}
            />
          )}
        </Field>
      </div>

      <Field label="location" hint="what guests see, e.g. a meet link.">
        {(props) => (
          <Input
            {...props}
            name="locationDetail"
            value={fields.locationDetail}
            onChange={update("locationDetail")}
            placeholder={defaultLocation}
          />
        )}
      </Field>
      {/* `location` is the coarse word guests fall back to when the field above
          is blank, and nothing in this app writes anything but "video" — a
          picker for it would be a control with one real answer. So it is only
          sent on the edit path, where its job is to carry a stored value
          through untouched; on create the action's own default supplies it. */}
      {eventType ? <input type="hidden" name="location" value={eventType.location} /> : null}

      <div>
        <Switch
          checked={active}
          onChange={setActive}
          labelPosition="start"
          label="visible"
          description="hidden types keep their bookings but leave the landing page."
        />
        {/* Hidden input, not a hidden checkbox: React's post-submit form reset
            restores a checkbox to the defaultChecked it captured at mount, so a
            type toggled hidden would quietly go visible again on the next save
            while this Switch still read "off". */}
        <input type="hidden" name="active" value={active ? "1" : "0"} />
      </div>

      {state.error ? (
        <Callout variant="danger" title="couldn't save">
          {state.error}
        </Callout>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="solid" disabled={pending}>
          {pending ? "saving…" : eventType ? "save changes" : "create"}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          cancel
        </Button>
      </div>
    </form>
  );
}
