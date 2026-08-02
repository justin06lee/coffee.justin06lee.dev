"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type Step = {
  label: React.ReactNode;
  /** Second line under the label. */
  description?: React.ReactNode;
};

export type StepperProps = {
  steps: Step[];
  /** Zero-based index of the step in progress. */
  current: number;
  orientation?: "horizontal" | "vertical";
  /**
   * Makes completed steps clickable so a user can go back and change an
   * earlier answer. Steps ahead of `current` stay inert — they aren't reachable
   * yet, and rendering them as buttons would say otherwise.
   */
  onStepClick?: (index: number) => void;
  /** Drop the numbers and descriptions for a compact progress rail. */
  compact?: boolean;
  /** Accessible name for the list. */
  ariaLabel?: string;
  className?: string;
};

/**
 * Numbered progress rail for a multi-step flow.
 *
 * Distinct from `tabs`, which switches between peers you can visit in any
 * order: a stepper asserts sequence and completion, so it renders as an
 * ordered list, marks the active step with `aria-current`, and refuses to make
 * un-reached steps clickable.
 */
export function Stepper({
  steps,
  current,
  orientation = "horizontal",
  onStepClick,
  compact = false,
  ariaLabel = "progress",
  className,
}: StepperProps) {
  const vertical = orientation === "vertical";

  return (
    <ol
      aria-label={ariaLabel}
      className={cn(
        "flex",
        vertical ? "flex-col gap-0" : "flex-row items-start gap-0",
        className,
      )}
    >
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        const clickable = Boolean(onStepClick) && done;
        const last = index === steps.length - 1;

        const marker = (
          <span
            aria-hidden
            className={cn(
              "flex size-6 shrink-0 items-center justify-center border font-mono text-[11px] tabular-nums transition-colors",
              done && "border-white bg-white text-black",
              active && "border-white text-white",
              !done && !active && "border-white/20 text-white/30",
            )}
          >
            {done ? <Check className="size-3" strokeWidth={2} /> : index + 1}
          </span>
        );

        const text = compact ? null : (
          <span className="flex min-w-0 flex-col gap-0.5">
            <span
              className={cn(
                "text-sm transition-colors",
                active ? "text-white" : done ? "text-white/70" : "text-white/30",
              )}
            >
              {step.label}
            </span>
            {step.description ? (
              <span className="text-[11px] leading-relaxed text-white/35">
                {step.description}
              </span>
            ) : null}
          </span>
        );

        // The connector belongs to the step before the gap, so the last step
        // doesn't trail a line into nothing.
        const connector = last ? null : (
          <span
            aria-hidden
            className={cn(
              "bg-white/15",
              vertical ? "ml-3 w-px flex-1" : "mt-3 h-px flex-1",
              done && "bg-white/40",
            )}
          />
        );

        const body = (
          <span className={cn("flex items-start gap-3", compact && "gap-0")}>
            {marker}
            {text}
          </span>
        );

        return (
          <li
            key={index}
            aria-current={active ? "step" : undefined}
            className={cn(
              "flex",
              vertical ? "flex-col" : "flex-1 flex-col last:flex-none",
            )}
          >
            <div className={cn("flex", vertical ? "flex-row items-start gap-3" : "items-start gap-3")}>
              {clickable ? (
                <button
                  type="button"
                  onClick={() => onStepClick?.(index)}
                  className={cn(
                    "text-left transition-opacity hover:opacity-80",
                    "focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50",
                  )}
                >
                  {body}
                  <span className="sr-only"> (completed — go back)</span>
                </button>
              ) : (
                body
              )}
              {!vertical && connector}
            </div>
            {vertical && !last ? (
              <span className="flex h-6 flex-col">{connector}</span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
