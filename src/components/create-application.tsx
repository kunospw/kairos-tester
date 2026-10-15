"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-api";
import { FormError } from "@/components/form-error";
import { Modal } from "@/components/modal";

export function CreateApplication({ primary = false, defaultOpen = false }: { primary?: boolean; defaultOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const app = await apiFetch<{ id: string }>("/api/apps", { method: "POST", json: { name, description } });
      router.push(`/apps/${app.id}/settings`);
      router.refresh();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <>
      <button className={primary ? "btn-primary" : "btn-secondary"} onClick={() => setOpen(true)}>
        New application
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="New application">
        <form onSubmit={submit} className="space-y-3">
          <FormError error={error} />
          <div>
            <label className="label" htmlFor="app-name">Name</label>
            <input id="app-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. KFastTrack" />
          </div>
          <div>
            <label className="label" htmlFor="app-desc">Description</label>
            <textarea id="app-desc" className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Creating…" : "Create"}</button>
          </div>
        </form>
      </Modal>
    </>
  );
}
