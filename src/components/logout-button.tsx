"use client";

import { useTransition } from "react";
import { logout } from "@/app/admin/actions";
import { Button } from "@/components/chrome/button";

export function LogoutButton() {
  const [pending, startTransition] = useTransition();

  // The action ends in redirect(), and next signals that by *rejecting* the
  // action promise with NEXT_REDIRECT so the redirect boundary can catch it.
  // `void logout()` threw that rejection on the floor — navigation still
  // worked, but every log out fired an unhandled rejection at the dev overlay
  // and at whatever reporter is listening. A transition hands it to the
  // boundary instead.
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() => startTransition(() => logout())}
    >
      {pending ? "logging out…" : "log out"}
    </Button>
  );
}
