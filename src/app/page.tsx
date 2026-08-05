import Link from "next/link";
import { ArrowRight, Clock, MapPin } from "lucide-react";
import { Badge } from "@/components/chrome/badge";
import { Callout } from "@/components/chrome/callout";
import { Chrome } from "@/components/chrome/chrome";
import { EmptyState } from "@/components/chrome/empty-state";
import { FadeIn } from "@/components/chrome/fade-in";
import { SiteHeader } from "@/components/site-header";
import { landingData } from "@/lib/page-data";
import { formatDuration } from "@/lib/time";

// Availability and the event-type list are both live state; a cached landing
// page would offer meetings that were archived an hour ago.
export const dynamic = "force-dynamic";

export default async function Home() {
  const { settings, eventTypes } = await landingData();

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-16 sm:px-8 sm:py-24">
        <FadeIn>
          <h1 className="text-3xl tracking-tight sm:text-4xl">
            <Chrome>{settings.hostName}</Chrome>
          </h1>
          {settings.hostBio ? (
            <p className="mt-3 max-w-lg text-[15px] leading-7 text-white/60">
              {settings.hostBio}
            </p>
          ) : null}
        </FadeIn>

        <FadeIn delay={0.1}>
          <p className="mt-10 font-mono text-[11px] uppercase tracking-[0.18em] text-white/40">
            pick a reason
          </p>
        </FadeIn>

        {!settings.bookingsOpen ? (
          <FadeIn delay={0.15}>
            <Callout className="mt-4" variant="warn" title="not taking bookings right now">
              {settings.closedMessage}
            </Callout>
          </FadeIn>
        ) : eventTypes.length === 0 ? (
          <FadeIn delay={0.15}>
            <EmptyState
              className="mt-4"
              title="nothing on offer yet"
              description="no meeting types are set up. check back later."
            />
          </FadeIn>
        ) : (
          <ul className="mt-4 flex flex-col gap-3">
            {eventTypes.map((eventType, index) => (
              <FadeIn key={eventType.id} delay={0.15 + index * 0.05}>
                <li>
                  <Link
                    href={`/${eventType.slug}`}
                    className="group flex items-start justify-between gap-4 border border-white/10 p-5 transition-colors hover:border-white/30 hover:bg-white/[0.03]"
                  >
                    <span className="flex min-w-0 flex-col gap-2">
                      <span className="text-lg leading-tight text-white">
                        {eventType.title}
                      </span>
                      {eventType.blurb ? (
                        <span className="text-[13px] leading-relaxed text-white/50">
                          {eventType.blurb}
                        </span>
                      ) : null}
                      <span className="mt-1 flex flex-wrap items-center gap-2">
                        <Badge className="gap-1">
                          <Clock aria-hidden className="size-3" strokeWidth={1.5} />
                          {formatDuration(eventType.durationMin)}
                        </Badge>
                        <Badge className="gap-1">
                          <MapPin aria-hidden className="size-3" strokeWidth={1.5} />
                          {eventType.locationDetail || eventType.location}
                        </Badge>
                      </span>
                    </span>
                    <ArrowRight
                      aria-hidden
                      className="mt-1 size-4 shrink-0 text-white/25 transition-transform group-hover:translate-x-0.5 group-hover:text-white"
                      strokeWidth={1.5}
                    />
                  </Link>
                </li>
              </FadeIn>
            ))}
          </ul>
        )}

        <FadeIn delay={0.4}>
          <p className="mt-12 text-[11px] leading-relaxed text-white/30">
            times are shown in your zone once you pick something. i&apos;m in{" "}
            {settings.timeZone.replace(/_/g, " ").toLowerCase()}.
          </p>
        </FadeIn>
      </main>
    </div>
  );
}
