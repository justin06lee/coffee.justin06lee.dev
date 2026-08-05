import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, clientIpFrom, validateSession } from "./auth";

export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return false;
  return validateSession(token);
}

/**
 * The guard every mutating server action opens with.
 *
 * It redirects rather than throwing. `throw new Error("unauthorized.")` reached
 * no catch at any call site: `startTransition` re-throws a rejected action
 * during render, so a session that expired while the tab sat open (24h — see
 * SESSION_TTL) turned the next click on "cancel booking" or "save settings"
 * into a replaced page and an "Application error", losing whatever was
 * unsaved and never saying "you're logged out".
 *
 * `redirect` throws too, but it throws NEXT_REDIRECT, which Next routes to the
 * redirect boundary — so the admin lands on the login form, which is both the
 * honest answer and the thing they need to do next.
 */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) {
    redirect("/login");
  }
}

export async function currentClientIp(): Promise<string> {
  return clientIpFrom(await headers());
}
