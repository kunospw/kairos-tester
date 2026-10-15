"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function CyclePicker({
  cycles,
  value,
  label = "Cycle",
}: {
  cycles: { id: string; name: string; kind: string }[];
  value: string | null;
  label?: string;
}) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="font-medium text-slate-600">{label}</span>
      <select
        className="input w-auto min-w-56"
        value={value ?? ""}
        onChange={(e) => {
          const p = new URLSearchParams(params.toString());
          if (e.target.value) p.set("cycle", e.target.value);
          else p.delete("cycle");
          router.push(`${path}?${p.toString()}`);
        }}
      >
        {cycles.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
            {c.kind === "SIMULATION" ? " (simulation)" : c.kind === "HISTORICAL_IMPORT" ? " (imported)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
