"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type StripDay = {
  /** Stable identity, typically a "YYYY-MM-DD" date key. */
  value: string;
  /** Big line — the day number. */
  label: React.ReactNode;
  /** Small line above it — "mon", "tue". */
  weekday?: React.ReactNode;
  /**
   * How much is available. `0` renders the day as unavailable; `undefined`
   * means "unknown", which is what a still-loading strip should pass so the
   * day doesn't falsely read as full.
   */
  count?: number;
  disabled?: boolean;
  /** Marks today with a rule under the number. */
  today?: boolean;
};

export type DateStripProps = {
  days: StripDay[];
  value: string | null;
  onChange: (value: string) => void;
  /** Mono uppercase caption above the strip — usually the month. */
  label?: React.ReactNode;
  /** Show the scroll arrows. They hide themselves when nothing overflows. */
  arrows?: boolean;
  /** Render availability as a dot under the number. */
  showCount?: boolean;
  ariaLabel?: string;
  className?: string;
};

/**
 * A horizontal run of days — the linear counterpart to `calendar`'s month
 * grid, for when the next opening matters more than which week it's in.
 *
 * Availability is a dot rather than a number: at strip size the exact count is
 * unreadable anyway, and the only question the strip has to answer is "is
 * there anything on this day". A day with a known count of zero is disabled;
 * a day with no count at all is left alone, so a loading strip doesn't tell
 * the guest their week is empty.
 */
export function DateStrip({
  days,
  value,
  onChange,
  label,
  arrows = true,
  showCount = true,
  ariaLabel = "pick a day",
  className,
}: DateStripProps) {
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const [overflow, setOverflow] = React.useState(false);

  const isUnavailable = (day: StripDay) => day.disabled || day.count === 0;

  const selectable = days
    .map((day, index) => ({ day, index }))
    .filter(({ day }) => !isUnavailable(day));

  const selectedIndex = days.findIndex((d) => d.value === value);
  const tabbableIndex = selectedIndex >= 0 ? selectedIndex : (selectable[0]?.index ?? -1);

  // Arrows are pointless when everything already fits, and misleading when the
  // strip has been resized narrower. Watching the element covers both.
  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => setOverflow(el.scrollWidth > el.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [days.length]);

  // Keep the selected day in view when it changes from outside — a "next
  // available" button elsewhere on the page shouldn't leave it off-screen.
  React.useEffect(() => {
    if (selectedIndex < 0) return;
    refs.current[selectedIndex]?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [selectedIndex]);

  function scrollBy(direction: 1 | -1) {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(160, el.clientWidth * 0.8), behavior: "smooth" });
  }

  function move(fromIndex: number, delta: number) {
    if (selectable.length === 0) return;
    const position = selectable.findIndex(({ index }) => index === fromIndex);
    const nextPosition = Math.min(
      selectable.length - 1,
      Math.max(0, (position < 0 ? 0 : position) + delta),
    );
    const next = selectable[nextPosition];
    if (!next) return;
    onChange(next.day.value);
    refs.current[next.index]?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent, index: number) {
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        move(index, 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        move(index, -1);
        break;
      case "Home":
        event.preventDefault();
        if (selectable[0]) {
          onChange(selectable[0].day.value);
          refs.current[selectable[0].index]?.focus();
        }
        break;
      case "End": {
        event.preventDefault();
        const last = selectable[selectable.length - 1];
        if (last) {
          onChange(last.day.value);
          refs.current[last.index]?.focus();
        }
        break;
      }
      default:
        break;
    }
  }

  const arrowButton = (direction: 1 | -1) => (
    <button
      type="button"
      onClick={() => scrollBy(direction)}
      aria-label={direction === 1 ? "later days" : "earlier days"}
      className={cn(
        "flex size-9 shrink-0 items-center justify-center border border-white/15",
        "text-white/50 transition-colors hover:border-white/40 hover:text-white",
        "focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50",
      )}
    >
      {direction === 1 ? (
        <ChevronRight aria-hidden className="size-4" strokeWidth={1.5} />
      ) : (
        <ChevronLeft aria-hidden className="size-4" strokeWidth={1.5} />
      )}
    </button>
  );

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {label ? (
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">
          {label}
        </span>
      ) : null}

      <div className="flex items-stretch gap-2">
        {arrows && overflow ? arrowButton(-1) : null}

        <div
          ref={scrollerRef}
          role="listbox"
          aria-label={ariaLabel}
          aria-orientation="horizontal"
          className="flex flex-1 gap-2 overflow-x-auto scroll-smooth"
        >
          {days.map((day, index) => {
            const selected = day.value === value;
            const unavailable = isUnavailable(day);
            return (
              <button
                key={day.value}
                ref={(el) => {
                  refs.current[index] = el;
                }}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={unavailable}
                tabIndex={index === tabbableIndex ? 0 : -1}
                onKeyDown={(e) => handleKeyDown(e, index)}
                onClick={() => !unavailable && onChange(day.value)}
                className={cn(
                  "flex min-w-14 shrink-0 flex-col items-center gap-1 border px-3 py-2 transition-colors",
                  "focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50",
                  selected
                    ? "border-white bg-white/10 text-white"
                    : "border-white/15 text-white/70 hover:border-white/40 hover:bg-white/5 hover:text-white",
                  unavailable &&
                    "cursor-not-allowed border-white/10 text-white/20 hover:border-white/10 hover:bg-transparent",
                )}
              >
                {day.weekday ? (
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">
                    {day.weekday}
                  </span>
                ) : null}
                <span className={cn("text-sm tabular-nums", day.today && "underline underline-offset-4")}>
                  {day.label}
                </span>
                {showCount ? (
                  <span
                    aria-hidden
                    className={cn(
                      "size-1",
                      day.count === undefined
                        ? "bg-transparent"
                        : day.count > 0
                          ? "bg-white/70"
                          : "bg-transparent",
                    )}
                  />
                ) : null}
                {day.count !== undefined ? (
                  <span className="sr-only">
                    {day.count === 0 ? "no times" : `${day.count} times`}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {arrows && overflow ? arrowButton(1) : null}
      </div>
    </div>
  );
}
