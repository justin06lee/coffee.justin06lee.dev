"use client";

import { logout } from "@/app/admin/actions";
import { Button } from "@/components/chrome/button";

export function LogoutButton() {
  return (
    <Button variant="ghost" size="sm" onClick={() => void logout()}>
      log out
    </Button>
  );
}
