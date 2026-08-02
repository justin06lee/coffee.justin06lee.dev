import "server-only";
import { cookies, headers } from "next/headers";
import { SESSION_COOKIE_NAME, clientIpFrom, validateSession } from "./auth";

export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return false;
  return validateSession(token);
}

export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) {
    throw new Error("unauthorized.");
  }
}

export async function currentClientIp(): Promise<string> {
  return clientIpFrom(await headers());
}
