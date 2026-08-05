"use client";

import { useEffect } from "react";

/**
 * The last-resort boundary, for errors thrown by the root layout itself —
 * where `app/error.tsx` cannot help, because that boundary lives *inside* the
 * layout it would need to replace.
 *
 * This one supplies its own <html> and <body>: it substitutes for the root
 * layout rather than rendering within it, so nothing from `layout.tsx` is
 * available here — not the Geist font variable, not the black background. The
 * styling is therefore inline rather than Tailwind, since a failure this deep
 * may well be the stylesheet itself.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error-boundary]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1.5rem",
          padding: "0 1.5rem",
          background: "#000",
          color: "#fff",
          textAlign: "center",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      >
        <div>
          <p
            style={{
              margin: 0,
              fontSize: "11px",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.4)",
            }}
          >
            something broke
          </p>
          <h1 style={{ margin: "0.5rem 0 0", fontSize: "1.5rem", fontWeight: 400 }}>
            that didn&apos;t work
          </h1>
          <p
            style={{
              margin: "0.75rem auto 0",
              maxWidth: "24rem",
              fontSize: "15px",
              lineHeight: 1.75,
              color: "rgba(255,255,255,0.55)",
            }}
          >
            the site failed to start up. try again — if it keeps happening, it&apos;s
            on my end, not yours.
          </p>
        </div>

        <button
          type="button"
          onClick={reset}
          style={{
            padding: "0.5rem 1rem",
            fontSize: "14px",
            fontFamily: "inherit",
            color: "#000",
            background: "#fff",
            border: 0,
            cursor: "pointer",
          }}
        >
          try again
        </button>

        {error.digest ? (
          <p style={{ margin: 0, fontSize: "11px", color: "rgba(255,255,255,0.25)" }}>
            ref {error.digest}
          </p>
        ) : null}
      </body>
    </html>
  );
}
