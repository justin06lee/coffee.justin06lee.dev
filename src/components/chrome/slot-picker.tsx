"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type Slot = {
  /** Stable identity — an ISO string or an epoch-ms string both work. */
  value: string;
  /** What the guest reads, e.g. "9:30 am". */
  label: React.ReactNode;
  disabled?: boolean;
  /** Small trailing note on the row, e.g. "2 left". */
  note?: React.ReactNode;
};

export type SlotPickerProps = {
  slots: Slot[];
  /** Currently selected slot value, or null. */
  value: string | null;
  onChange: (value: string | null) => void;
  /**
   * Commits the selection. When set, choosing a slot splits the row in two and
   * reveals the confirm half in place, so the action lands under the cursor
   * that just picked the time rather than at the bottom of a long column.
   */
  onConfirm?: (value: string) => void;
  confirmLabel?: React.ReactNode;
  /** Column count. "auto" fills the container at ~7rem per column. */
  columns?: number | "auto";
  /** Mono uppercase caption above the grid. */
  label?: React.ReactNode;
  /** Muted line under the grid — the timezone the labels are in. */
  footnote?: React.ReactNode;
  /** Shown in place of the grid when there are no slots. */
  emptyState?: React.ReactNode;
  /** Disables every slot without emptying the grid. */
  disabled?: boolean;
  /** Spinner state for the confirm half. */
  confirming?: boolean;
  ariaLabel?: string;
  className?: string;
};

/**
 * A column of bookable times, with the two-step confirm a booking page wants.
 *
 * The interaction is the point: picking a time doesn't submit it. The chosen
 * row splits — the time slides left, a confirm button takes the other half —
 * so the commit is deliberate and reversible, and a mis-tap on a phone costs
 * nothing. Without `onConfirm` it degrades to a plain single-select grid.
 *
 * Roving tabindex over the whole grid: one tab stop in, arrows to move, which
 * matters because a day can hold thirty-odd slots and tabbing through all of
 * them to reach the afternoon is not navigation.
 */
export function SlotPicker({
  slots,
  value,
  onChange,
  onConfirm,
  confirmLabel = "confirm",
  columns = 1,
  label,
  footnote,
  emptyState,
  disabled = false,
  confirming = false,
  ariaLabel = "available times",
  className,
}: SlotPickerProps) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const selectable = slots
    .map((slot, index) => ({ slot, index }))
    .filter(({ slot }) => !slot.disabled && !disabled);

  const selectedIndex = slots.findIndex((s) => s.value === value);
  const tabbableIndex = selectedIndex >= 0 ? selectedIndex : (selectable[0]?.index ?? -1);

  function focusByOffset(fromIndex: number, delta: number) {
    if (selectable.length === 0) return;
    const position = selectable.findIndex(({ index }) => index === fromIndex);
    const nextPosition = Math.min(
      selectable.length - 1,
      Math.max(0, (position < 0 ? 0 : position) + delta),
    );
    const next = selectable[nextPosition];
    if (next) refs.current[next.index]?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent, index: number) {
    const perRow = typeof columns === "number" ? columns : 1;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusByOffset(index, perRow);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusByOffset(index, -perRow);
        break;
      case "ArrowRight":
        event.preventDefault();
        focusByOffset(index, 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        focusByOffset(index, -1);
        break;
      case "Home":
        event.preventDefault();
        if (selectable[0]) refs.current[selectable[0].index]?.focus();
        break;
      case "End": {
        event.preventDefault();
        const last = selectable[selectable.length - 1];
        if (last) refs.current[last.index]?.focus();
        break;
      }
      default:
        break;
    }
  }

  const gridStyle: React.CSSProperties =
    columns === "auto"
      ? { gridTemplateColumns: "repeat(auto-fill, minmax(7rem, 1fr))" }
      : { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` };

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {label ? (
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">
          {label}
        </span>
      ) : null}

      {slots.length === 0 ? (
        emptyState ?? (
          <p className="border border-dashed border-white/15 px-4 py-8 text-center text-sm text-white/40">
            nothing available
          </p>
        )
      ) : (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className="grid gap-2"
          style={gridStyle}
        >
          {slots.map((slot, index) => {
            const selected = slot.value === value;
            const isDisabled = disabled || slot.disabled;
            const split = selected && Boolean(onConfirm);

            return (
              <div key={slot.value} className={cn("flex", split && "gap-2")}>
                <button
                  ref={(el) => {
                    refs.current[index] = el;
                  }}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={isDisabled}
                  tabIndex={index === tabbableIndex ? 0 : -1}
                  onKeyDown={(e) => handleKeyDown(e, index)}
                  onClick={() => {
                    if (isDisabled) return;
                    // Clicking the selected slot again deselects it, which is
                    // the only way back out of the split state by mouse.
                    onChange(selected ? null : slot.value);
                  }}
                  className={cn(
                    "flex min-w-0 flex-1 items-center justify-center gap-2 border px-3 py-2.5",
                    "text-sm tabular-nums transition-colors",
                    "focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50",
                    selected
                      ? "border-white bg-white/10 text-white"
                      : "border-white/20 text-white/80 hover:border-white/50 hover:bg-white/5 hover:text-white",
                    isDisabled &&
                      "cursor-not-allowed border-white/10 text-white/25 line-through hover:border-white/10 hover:bg-transparent",
                  )}
                >
                  <span className="truncate">{slot.label}</span>
                  {slot.note ? (
                    <span className="shrink-0 font-mono text-[10px] text-white/40">
                      {slot.note}
                    </span>
                  ) : null}
                </button>

                {split ? (
                  <button
                    type="button"
                    disabled={confirming}
                    onClick={() => onConfirm?.(slot.value)}
                    className={cn(
                      "flex min-w-0 flex-1 items-center justify-center border border-white",
                      "bg-white px-3 py-2.5 text-sm text-black transition-colors",
                      "hover:bg-white/90 disabled:opacity-60",
                      "focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50",
                    )}
                  >
                    {confirming ? "…" : confirmLabel}
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {footnote ? (
        <p className="pt-1 text-[11px] leading-relaxed text-white/40">{footnote}</p>
      ) : null}
    </div>
  );
}
