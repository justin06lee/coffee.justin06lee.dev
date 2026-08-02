import Link from "next/link";
import { cn } from "@/lib/utils";

export type SiteHeaderProps = {
  /** Breadcrumb-ish trail shown after the brand. */
  trail?: { label: string; href?: string }[];
  /** Right-side slot — an admin link, a back link. */
  actions?: React.ReactNode;
  className?: string;
};

/**
 * The thin top rule every page carries. Deliberately not `navbar`: there is no
 * menu to open here, and a mobile drawer holding one link would be furniture
 * for its own sake.
 */
export function SiteHeader({ trail = [], actions, className }: SiteHeaderProps) {
  return (
    <header
      className={cn(
        "flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4 sm:px-8",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <Link
          href="/"
          className="shrink-0 tracking-tight text-white transition-opacity hover:opacity-70"
        >
          coffee
        </Link>
        {trail.map((crumb, index) => (
          <span key={index} className="flex min-w-0 items-center gap-2">
            <span aria-hidden className="text-white/20">
              /
            </span>
            {crumb.href ? (
              <Link
                href={crumb.href}
                className="truncate text-white/50 transition-colors hover:text-white"
              >
                {crumb.label}
              </Link>
            ) : (
              <span className="truncate text-white/50">{crumb.label}</span>
            )}
          </span>
        ))}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
