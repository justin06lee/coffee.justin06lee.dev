import * as React from "react";
import { cn } from "@/lib/utils";

export type DetailItem = {
  label: React.ReactNode;
  value: React.ReactNode;
  /** 14px lucide icon rendered before the value. */
  icon?: React.ReactNode;
  /** Muted line under the value — a caveat, a source, a secondary reading. */
  note?: React.ReactNode;
  /** Let this row span both columns in the "grid" layout. */
  wide?: boolean;
};

export type DetailListLayout = "rows" | "grid" | "stacked";

export type DetailListProps = {
  items: DetailItem[];
  /**
   * "rows" puts label and value on one line (label left, value right);
   * "grid" is a two-column card of label-over-value cells; "stacked" is a
   * single column of label-over-value.
   */
  layout?: DetailListLayout;
  /** Hairlines between rows. Only meaningful for "rows". */
  divided?: boolean;
  dense?: boolean;
  className?: string;
};

/**
 * Label/value metadata as a real `<dl>`.
 *
 * The library had `stat-tile` for one big number and `manager-table` for many
 * rows of the same shape, but nothing for the confirmation-page case: a
 * handful of unrelated facts about one thing. Every call site was building a
 * div grid, which reads to a screen reader as an undifferentiated pile rather
 * than as term/definition pairs.
 */
export function DetailList({
  items,
  layout = "rows",
  divided = true,
  dense = false,
  className,
}: DetailListProps) {
  const pad = dense ? "py-1.5" : "py-2.5";

  if (layout === "rows") {
    return (
      <dl className={cn("flex flex-col", className)}>
        {items.map((item, index) => (
          // `<dt>`/`<dd>` must be direct children of `<dl>` to keep the
          // pairing, so the row styling lives on the pair, not on a wrapper.
          <React.Fragment key={index}>
            <div
              className={cn(
                "flex items-baseline justify-between gap-6",
                pad,
                divided && index > 0 && "border-t border-white/10",
              )}
            >
              <dt className="shrink-0 font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">
                {item.label}
              </dt>
              <dd className="flex min-w-0 flex-col items-end gap-0.5 text-right">
                <span className="flex items-center gap-2 text-sm text-white">
                  {item.icon ? (
                    <span aria-hidden className="text-white/40">
                      {item.icon}
                    </span>
                  ) : null}
                  {item.value}
                </span>
                {item.note ? (
                  <span className="text-[11px] text-white/40">{item.note}</span>
                ) : null}
              </dd>
            </div>
          </React.Fragment>
        ))}
      </dl>
    );
  }

  return (
    <dl
      className={cn(
        layout === "grid"
          ? "grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2"
          : "flex flex-col gap-4",
        className,
      )}
    >
      {items.map((item, index) => (
        <div
          key={index}
          className={cn("flex flex-col gap-1", item.wide && "sm:col-span-2")}
        >
          <dt className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">
            {item.label}
          </dt>
          <dd className="flex flex-col gap-0.5">
            <span className="flex items-center gap-2 text-sm text-white">
              {item.icon ? (
                <span aria-hidden className="text-white/40">
                  {item.icon}
                </span>
              ) : null}
              {item.value}
            </span>
            {item.note ? (
              <span className="text-[11px] leading-relaxed text-white/40">{item.note}</span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
