"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-api";
import { FormError } from "@/components/form-error";
import { Card } from "@/components/ui";

const TYPES = ["DEVELOPMENT", "TEST", "DEMO", "UAT", "STAGING", "PRODUCTION", "OTHER"];

export function EnvironmentManager({
  appId,
  environments,
}: {
  appId: string;
  environments: { id: string; name: string; type: string; targetUrl: string | null; notes: string | null; cycles: number }[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState("TEST");
  const [targetUrl, setTargetUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<unknown>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch(`/api/apps/${appId}/environments`, { method: "POST", json: { name, type, targetUrl: targetUrl || null, notes } });
      setName("");
      setTargetUrl("");
      setNotes("");
      router.refresh();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Card title="Environments">
      {environments.length === 0 ? (
        <p className="mb-3 text-sm text-slate-500">No environments yet. Add the environments you test against (for example Demo and Cloud2).</p>
      ) : (
        <table className="table-base mb-4">
          <thead>
            <tr><th>Name</th><th>Type</th><th>Target URL</th><th>Notes</th><th className="text-right">Cycles</th></tr>
          </thead>
          <tbody>
            {environments.map((e) => (
              <tr key={e.id}>
                <td className="font-medium">{e.name}</td>
                <td className="text-xs">{e.type.toLowerCase()}</td>
                <td className="text-xs">{e.targetUrl ? <a className="text-teal-700 underline" href={e.targetUrl} target="_blank" rel="noreferrer noopener">{e.targetUrl}</a> : "—"}</td>
                <td className="text-xs">{e.notes ?? ""}</td>
                <td className="text-right">{e.cycles}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form onSubmit={add} className="grid gap-2 md:grid-cols-5">
        <FormError error={error} />
        <input className="input" placeholder="Name (e.g. Demo)" value={name} onChange={(e) => setName(e.target.value)} required aria-label="Environment name" />
        <select className="input" value={type} onChange={(e) => setType(e.target.value)} aria-label="Environment type">
          {TYPES.map((t) => <option key={t} value={t}>{t.toLowerCase()}</option>)}
        </select>
        <input className="input" placeholder="Target URL (optional)" value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} aria-label="Target URL" />
        <input className="input" placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Notes" />
        <button className="btn-primary" type="submit">Add environment</button>
      </form>
      <p className="mt-2 text-xs text-slate-500">Target URLs are only shown as links for testers to open the application themselves. Kairos Tester never contacts them.</p>
    </Card>
  );
}
