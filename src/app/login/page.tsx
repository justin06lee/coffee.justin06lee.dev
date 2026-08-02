import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth-server";
import { SiteHeader } from "@/components/site-header";
import { AdminLogin } from "@/components/admin-login";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "log in",
  robots: { index: false, follow: false },
};

export default async function LoginPage() {
  // Already signed in: skip the form rather than let a valid session sit on a
  // login screen.
  if (await isAdmin()) redirect("/admin");

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-5 py-16">
        <AdminLogin />
      </main>
    </div>
  );
}
