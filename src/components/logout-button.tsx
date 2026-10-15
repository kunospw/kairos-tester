"use client";
import { apiFetch } from "@/lib/client-api";

export function LogoutButton() {
  return (
    <button
      type="button"
      className="rounded border border-navy-600 px-2 py-1 text-xs text-navy-100 hover:bg-navy-800 hover:text-white"
      onClick={async () => {
        await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
        window.location.href = "/login";
      }}
    >
      Sign out
    </button>
  );
}
