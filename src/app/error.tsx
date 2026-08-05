"use client";

import { useEffect } from "react";
import { Button } from "@/components/chrome/button";

/**
 * The segment error boundary.
 *
 * Without a boundary here, anything that throws on the server — a Turso
 * outage, a `requireAdmin()` rejection reaching a render, an unhandled edge in
 * the slot engine — renders Next's stock error screen: white, unstyled, and
 * off-brand on a black site.
 *
 * `error.message` is deliberately not shown. In production Next already
 * replaces it with a generic string and a digest, but this component also runs
 * in development against real messages, and the ones this app produces name
 * environment variables and table names. The digest is enough to find the
 * matching server log.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[error-boundary]", error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">
          something broke
        </p>
        <h1 className="mt-2 text-2xl tracking-tight sm:text-3xl">
          that didn&apos;t work
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-[15px] leading-7 text-white/55">
          the calendar is having a moment. try again — if it keeps happening,
          it&apos;s on my end, not yours.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button variant="solid" onClick={reset}>
          try again
        </Button>
        <Button variant="ghost" href="/">
          back to the start
        </Button>
      </div>

      {error.digest ? (
        <p className="font-mono text-[11px] text-white/25">ref {error.digest}</p>
      ) : null}
    </div>
  );
}
