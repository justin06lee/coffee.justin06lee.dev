"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type RadioOption<T extends string | number> = {
  value: T;
  label: React.ReactNode;
  /** Second line under the label. Only rendered by the "cards" variant. */
  description?: React.ReactNode;
  /** Trailing slot — a price, a duration, a badge. Cards only. */
  meta?: React.ReactNode;
  disabled?: boolean;
};

export type RadioGroupVariant = "list" | "cards";

export type RadioGroupProps<T extends string | number> = {
  value: T | null;
  onChange: (value: T) => void;
  options: RadioOption<T>[];
  /** Mono uppercase caption above the group. */
  label?: React.ReactNode;
  variant?: RadioGroupVariant;
  orientation?: "vertical" | "horizontal";
  /** Accessible name when there is no visible `label`. */
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
};

/**
 * Single-choice group with roving tabindex.
 *
 * The registry shipped `checkbox` but nothing for "exactly one of these",
 * which left call sites either faking it with buttons — losing the arrow-key
 * contract screen-reader users expect from a radiogroup — or reaching for a
 * `select` on a three-option choice.
 *
 * Arrows move focus *and* selection, wrapping at the ends and skipping
 * disabled options, which is the ARIA-recommended behaviour for a radiogroup;
 * only the selected option is tabbable, so the group is one tab stop.
 */
export function RadioGroup<T extends string | number>({
  value,
  onChange,
  options,
  label,
  variant = "list",
  orientation = "vertical",
  ariaLabel,
  disabled = false,
  className,
}: RadioGroupProps<T>) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options
    .map((o, i) => ({ o, i }))
    .filter(({ o }) => !o.disabled && !disabled);

  const selectedIndex = options.findIndex((o) => o.value === value);
  // With nothing selected the first enabled option holds the tab stop, so the
  // group is always reachable by keyboard.
  const tabbableIndex = selectedIndex >= 0 ? selectedIndex : (enabled[0]?.i ?? -1);

  function move(fromIndex: number, delta: number) {
    if (enabled.length === 0) return;
    const position = enabled.findIndex(({ i }) => i === fromIndex);
    const nextPosition =
      position < 0
        ? 0
        : (position + delta + enabled.length) % enabled.length;
    const next = enabled[nextPosition];
    if (!next) return;
    onChange(next.o.value);
    refs.current[next.i]?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent, index: number) {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowRight":
        event.preventDefault();
        move(index, 1);
        break;
      case "ArrowUp":
      case "ArrowLeft":
        event.preventDefault();
        move(index, -1);
        break;
      case "Home":
        event.preventDefault();
        if (enabled[0]) {
          onChange(enabled[0].o.value);
          refs.current[enabled[0].i]?.focus();
        }
        break;
      case "End": {
        event.preventDefault();
        const last = enabled[enabled.length - 1];
        if (last) {
          onChange(last.o.value);
          refs.current[last.i]?.focus();
        }
        break;
      }
      default:
        break;
    }
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {label ? (
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">
          {label}
        </span>
      ) : null}
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        aria-orientation={orientation}
        className={cn(
          "flex",
          orientation === "vertical" ? "flex-col gap-2" : "flex-row flex-wrap gap-2",
        )}
      >
        {options.map((option, index) => {
          const selected = option.value === value;
          const isDisabled = disabled || option.disabled;
          return (
            <button
              key={String(option.value)}
              ref={(el) => {
                refs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={isDisabled}
              tabIndex={index === tabbableIndex ? 0 : -1}
              onClick={() => !isDisabled && onChange(option.value)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className={cn(
                "group flex items-start gap-3 border text-left transition-colors",
                "focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50",
                variant === "cards" ? "p-4" : "px-3 py-2",
                selected
                  ? "border-white/40 bg-white/5 text-white"
                  : "border-white/10 text-white/70 hover:border-white/25 hover:bg-white/5 hover:text-white",
                isDisabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
              )}
            >
              {/* The dot is square like everything else; the inner fill is the
                  only thing that changes, so selection reads at a glance
                  without a color shift. */}
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex size-3.5 shrink-0 items-center justify-center border",
                  selected ? "border-white" : "border-white/30",
                )}
              >
                <span className={cn("size-1.5", selected ? "bg-white" : "bg-transparent")} />
              </span>

              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="text-sm">{option.label}</span>
                  {variant === "cards" && option.meta ? (
                    <span className="shrink-0 font-mono text-[11px] text-white/40">
                      {option.meta}
                    </span>
                  ) : null}
                </span>
                {variant === "cards" && option.description ? (
                  <span className="text-[13px] leading-relaxed text-white/50">
                    {option.description}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
