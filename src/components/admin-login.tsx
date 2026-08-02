"use client";

import { useRouter } from "next/navigation";
import { login } from "@/app/admin/actions";
import { LoginForm } from "@/components/chrome/login-form";

/**
 * Thin shell over chrome's `LoginForm`, which takes no transport of its own.
 * The password goes straight to the server action and is never held in a state
 * this component owns.
 */
export function AdminLogin() {
  const router = useRouter();

  return (
    <LoginForm
      title="admin"
      submitLabel="log in"
      onSubmit={async ({ password }) => {
        const result = await login(String(password ?? ""));
        if (result.error) {
          return { error: result.error, rateLimited: result.rateLimited };
        }
        router.replace("/admin");
        router.refresh();
        return {};
      }}
    />
  );
}
