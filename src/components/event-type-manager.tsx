"use client";

import { useActionState, useState, useTransition } from "react";
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
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await removeEventType(eventType.id);
                        setDeleteError(result.error);
                      })
                    }
                  />
                </div>
              </div>

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

function EventTypeForm({
  eventType,
  defaultLocation,
  onDone,
}: {
  eventType?: EventType;
  defaultLocation: string;
  onDone: () => void;
}) {
  const [active, setActive] = useState(eventType?.active ?? true);
  const [state, formAction, pending] = useActionState<EventTypeFormState, FormData>(
    async (prev, formData) => {
      const result = await saveEventType(prev, formData);
      // Only close on success — an error has to stay on screen next to the
      // field that caused it.
      if (!result.error) onDone();
      return result;
    },
    { error: null },
  );

  return (
    <form action={formAction} className="flex flex-col gap-5 border border-white/10 p-5">
      {eventType ? <input type="hidden" name="id" value={eventType.id} /> : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="title" required>
          {(props) => <Input {...props} name="title" defaultValue={eventType?.title} />}
        </Field>
        <Field label="slug" hint="left empty, it's made from the title.">
          {(props) => (
            <Input {...props} name="slug" defaultValue={eventType?.slug} placeholder="coffee" />
          )}
        </Field>
      </div>

      <Field label="blurb" optional>
        {(props) => (
          <Textarea {...props} name="blurb" rows={2} defaultValue={eventType?.blurb ?? ""} />
        )}
      </Field>

      <div className="grid gap-5 sm:grid-cols-3">
        <Field label="length" hint="minutes">
          {(props) => (
            <Input
              {...props}
              name="durationMin"
              type="number"
              min={5}
              max={480}
              defaultValue={eventType?.durationMin ?? 30}
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
              defaultValue={eventType?.incrementMin ?? 15}
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
              defaultValue={eventType?.bufferAfterMin ?? 0}
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
              defaultValue={eventType?.minNoticeMin ?? 720}
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
              defaultValue={eventType?.maxDaysAhead ?? 45}
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
              defaultValue={eventType?.dailyLimit ?? ""}
            />
          )}
        </Field>
      </div>

      <Field label="location" hint="what guests see, e.g. a meet link.">
        {(props) => (
          <Input
            {...props}
            name="locationDetail"
            defaultValue={eventType?.locationDetail ?? ""}
            placeholder={defaultLocation}
          />
        )}
      </Field>
      <input type="hidden" name="location" value={eventType?.location ?? "video"} />
      <input type="hidden" name="bufferBeforeMin" value={eventType?.bufferBeforeMin ?? 0} />

      <div>
        <Switch
          checked={active}
          onChange={setActive}
          labelPosition="start"
          label="visible"
          description="hidden types keep their bookings but leave the landing page."
        />
        <input type="checkbox" name="active" checked={active} readOnly hidden />
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
