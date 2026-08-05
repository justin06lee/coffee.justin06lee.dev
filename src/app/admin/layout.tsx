import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth-server";
import { SiteHeader } from "@/components/site-header";
import { LogoutButton } from "@/components/logout-button";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "admin", template: "%s | admin" },
  robots: { index: false, follow: false },
};

const TABS = [
  { href: "/admin", label: "bookings" },
  { href: "/admin/availability", label: "availability" },
  { href: "/admin/event-types", label: "meeting types" },
];

/**
 * The auth boundary for everything under /admin.
 *
 * A layout guard covers every current and future page in the segment, which a
 * per-page check does not — but it is not the only guard: each mutating action
 * calls requireAdmin() itself, since server actions are reachable by POST
 * without ever rendering the layout that "protects" them.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isAdmin())) redirect("/login");

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader trail={[{ label: "admin", href: "/admin" }]} actions={<LogoutButton />} />

      <nav className="flex gap-1 overflow-x-auto border-b border-white/10 px-5 sm:px-8">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="whitespace-nowrap border-b border-transparent px-3 py-3 text-sm text-white/50 transition-colors hover:border-white/30 hover:text-white"
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {/*
        Every page in this segment opens at h2, and the layout contributed no
        heading — so the admin screens started their outline a level down and
        heading navigation skipped a rung on all three. The pages are
        distinguished by the breadcrumb and the document title; what was
        missing is the rung itself, not a second visible title, so this is
        sr-only rather than a design change.
      */}
      <h1 className="sr-only">admin</h1>

      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-10 sm:px-8">{children}</main>
    </div>
  );
}
