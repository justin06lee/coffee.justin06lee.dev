"use client";

import { useState, useTransition } from "react";
import { saveWeeklyRules } from "@/app/admin/actions";
import {
  AvailabilityGrid,
  isAvailabilityValid,
  type AvailabilityRange,
} from "@/components/chrome/availability-grid";
import { Button } from "@/components/chrome/button";
import { Callout } from "@/components/chrome/callout";

export type AvailabilityEditorProps = {
  initialRules: AvailabilityRange[];
};

/**
 * The weekly grid plus its save button.
 *
 * Saving replaces the whole schedule rather than diffing it, which is why the
 * editor holds the entire week in state: a partial save can't express "monday
 * afternoon is gone" without a delete list, and the grid already knows the
 * complete answer.
 */
export function AvailabilityEditor({ initialRules }: AvailabilityEditorProps) {
  const [ranges, setRanges] = useState<AvailabilityRange[]>(initialRules);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const valid = isAvailabilityValid(ranges);
  // Compared as sorted JSON rather than by reference: the grid rebuilds its
  // arrays on every keystroke, so reference equality would always say "dirty".
  const dirty = serialize(ranges) !== serialize(initialRules);

  return (
    <div className="flex flex-col gap-4">
      <AvailabilityGrid
        value={ranges}
        onChange={(next) => {
          setRanges(next);
          setSaved(false);
        }}
        disabled={pending}
      />

      {!valid ? (
        <Callout variant="danger" title="fix the windows above">
          a window has to end after it starts, and two windows on the same day can&apos;t
          overlap.
        </Callout>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
        <Button
          variant="solid"
          disabled={!valid || !dirty || pending}
          onClick={() =>
            startTransition(async () => {
              await saveWeeklyRules(ranges);
              setSaved(true);
            })
          }
        >
          {pending ? "saving…" : "save hours"}
        </Button>
        {dirty ? (
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setRanges(initialRules);
              setSaved(false);
            }}
          >
            discard changes
          </Button>
        ) : null}
        <span aria-live="polite" role="status" className="text-[13px] text-white/40">
          {saved && !dirty ? "saved." : dirty ? "unsaved changes" : ""}
        </span>
      </div>
    </div>
  );
}

function serialize(ranges: AvailabilityRange[]): string {
  return JSON.stringify(
    [...ranges].sort(
      (a, b) => a.weekday - b.weekday || a.startMin - b.startMin || a.endMin - b.endMin,
    ),
  );
}
