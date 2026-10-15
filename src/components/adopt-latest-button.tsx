"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, errorMessage } from "@/lib/client-api";

export function AdoptLatestButton({ ccId, latest }: { ccId: string; latest: number }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="ml-2 inline-flex items-center gap-2">
      <button
        className="btn-secondary btn-sm"
        onClick={async () => {
          try {
            await apiFetch(`/api/cycle-cases/${ccId}/adopt-latest`, { method: "POST" });
            router.refresh();
          } catch (e) {
            setErr(errorMessage(e));
          }
        }}
      >
        Use v{latest} for new attempts
      </button>
      {err && <span className="text-red-700">{err}</span>}
    </span>
  );
}
