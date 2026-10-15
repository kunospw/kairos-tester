"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/client-api";
import { FormError } from "@/components/form-error";
import { Card } from "@/components/ui";
import { CONTEXT_CATEGORY_LABEL } from "@/lib/domain";

interface Entry {
  id: string;
  category: string;
  title: string;
  body: string;
  status: string;
  sourceTitle: string | null;
  sourceExcerpt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
}
interface Source {
  id: string;
  kind: string;
  title: string;
  location: string | null;
  notes: string | null;
}

const STATUS_STYLE: Record<string, string> = {
  UNREVIEWED: "bg-amber-50 text-amber-900 ring-amber-300",
  REVIEWED: "bg-green-50 text-green-800 ring-green-300",
  OUTDATED: "bg-slate-100 text-slate-600 ring-slate-300 line-through",
};
const STATUS_LABEL: Record<string, string> = { UNREVIEWED: "Unreviewed", REVIEWED: "Reviewed", OUTDATED: "Outdated" };

export function ContextManager({ appId, entries, sources }: { appId: string; entries: Entry[]; sources: Source[] }) {
  const router = useRouter();
  const [error, setError] = useState<unknown>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ category: "BUSINESS_RULES", title: "", body: "", status: "UNREVIEWED", sourceReferenceId: "" });
  const [filter, setFilter] = useState("");
  const [srcDraft, setSrcDraft] = useState({ kind: "DOCUMENT", title: "", location: "" });

  async function call(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      router.refresh();
      return true;
    } catch (e) {
      setError(e);
      return false;
    }
  }

  const shown = entries.filter((e) => !filter || e.status === filter || e.category === filter);
  const grouped = Object.keys(CONTEXT_CATEGORY_LABEL).map((cat) => ({ cat, items: shown.filter((e) => e.category === cat) }));

  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <Card
        className="xl:col-span-2"
        title={`Application context (${entries.length} entries, ${entries.filter((e) => e.status === "REVIEWED").length} reviewed)`}
        actions={
          <div className="flex gap-2">
            <select className="input w-auto" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter context">
              <option value="">All</option>
              <option value="UNREVIEWED">Unreviewed only</option>
              <option value="REVIEWED">Reviewed only</option>
              <option value="OUTDATED">Outdated</option>
            </select>
            <button className="btn-secondary btn-sm" onClick={() => setAdding(true)}>Add entry</button>
          </div>
        }
      >
        <FormError error={error} />
        {adding && (
          <form
            className="mb-4 space-y-2 rounded border border-slate-200 bg-slate-50 p-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await call(() => apiFetch(`/api/apps/${appId}/context`, { method: "POST", json: { ...draft, sourceReferenceId: draft.sourceReferenceId || null } }))) {
                setAdding(false);
                setDraft({ ...draft, title: "", body: "" });
              }
            }}
          >
            <div className="grid gap-2 md:grid-cols-3">
              <select className="input" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} aria-label="Category">
                {Object.entries(CONTEXT_CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select className="input" value={draft.sourceReferenceId} onChange={(e) => setDraft({ ...draft, sourceReferenceId: e.target.value })} aria-label="Source">
                <option value="">No source reference</option>
                {sources.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
              <select className="input" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })} aria-label="Status">
                <option value="UNREVIEWED">Unreviewed</option>
                <option value="REVIEWED">Reviewed (I have verified this)</option>
              </select>
            </div>
            <input className="input" placeholder="Title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required aria-label="Title" />
            <textarea className="input" rows={4} placeholder="Content" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} required aria-label="Content" />
            <div className="flex gap-2">
              <button className="btn-primary btn-sm" type="submit">Save entry</button>
              <button className="btn-secondary btn-sm" type="button" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </form>
        )}
        {entries.length === 0 ? (
          <p className="text-sm text-slate-500">
            No context yet. Add roles, workflows, business rules, technical details, requirements and known gaps, or import a guidance sheet (such as “How to use”)
            during case import. Imported guidance arrives as unreviewed.
          </p>
        ) : (
          <div className="space-y-4">
            {grouped.filter((g) => g.items.length).map((g) => (
              <section key={g.cat}>
                <h3 className="mb-1 text-xs font-semibold text-slate-500">{CONTEXT_CATEGORY_LABEL[g.cat]}</h3>
                <ul className="space-y-2">
                  {g.items.map((e) => (
                    <li key={e.id} className="rounded border border-slate-200 p-3">
                      {editing === e.id ? (
                        <EditEntry
                          entry={e}
                          onCancel={() => setEditing(null)}
                          onSave={async (patch) => {
                            if (await call(() => apiFetch(`/api/apps/${appId}/context/${e.id}`, { method: "PATCH", json: patch }))) setEditing(null);
                          }}
                        />
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE[e.status]}`}>{STATUS_LABEL[e.status]}</span>
                            <strong className="text-sm">{e.title}</strong>
                          </div>
                          <p className="prewrap mt-1 text-sm text-slate-700">{e.body}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {e.sourceTitle ? `Source: ${e.sourceTitle}${e.sourceExcerpt ? ` (${e.sourceExcerpt})` : ""}` : "No source reference"}
                            {e.reviewedBy && ` · Reviewed by ${e.reviewedBy} ${e.reviewedAt}`}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {e.status !== "REVIEWED" && (
                              <button className="btn-secondary btn-sm" onClick={() => call(() => apiFetch(`/api/apps/${appId}/context/${e.id}`, { method: "PATCH", json: { status: "REVIEWED" } }))}>
                                Mark reviewed
                              </button>
                            )}
                            {e.status !== "OUTDATED" && (
                              <button className="btn-secondary btn-sm" onClick={() => call(() => apiFetch(`/api/apps/${appId}/context/${e.id}`, { method: "PATCH", json: { status: "OUTDATED" } }))}>
                                Mark outdated
                              </button>
                            )}
                            <button className="btn-secondary btn-sm" onClick={() => setEditing(e.id)}>Edit</button>
                            <button className="btn-danger btn-sm" onClick={() => call(() => apiFetch(`/api/apps/${appId}/context/${e.id}`, { method: "DELETE" }))}>Delete</button>
                          </div>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Card>

      <Card title={`Sources (${sources.length})`}>
        <ul className="mb-3 space-y-2 text-sm">
          {sources.map((s) => (
            <li key={s.id} className="rounded bg-slate-50 p-2">
              <p className="font-medium">{s.title}</p>
              <p className="text-xs text-slate-500">{s.kind.toLowerCase()}{s.location ? ` · ${s.location}` : ""}</p>
              {s.notes && <p className="text-xs text-slate-500">{s.notes}</p>}
            </li>
          ))}
          {sources.length === 0 && <li className="text-slate-500">No sources yet. Imports create one automatically.</li>}
        </ul>
        <form
          className="space-y-2 border-t border-slate-200 pt-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await call(() => apiFetch(`/api/apps/${appId}/sources`, { method: "POST", json: srcDraft }))) setSrcDraft({ ...srcDraft, title: "", location: "" });
          }}
        >
          <p className="label">Add a source reference</p>
          <select className="input" value={srcDraft.kind} onChange={(e) => setSrcDraft({ ...srcDraft, kind: e.target.value })} aria-label="Source kind">
            {["DOCUMENT", "URL", "REPOSITORY", "WORKBOOK", "CONVERSATION", "OTHER"].map((k) => <option key={k} value={k}>{k.toLowerCase()}</option>)}
          </select>
          <input className="input" placeholder="Title" required value={srcDraft.title} onChange={(e) => setSrcDraft({ ...srcDraft, title: e.target.value })} aria-label="Source title" />
          <input className="input" placeholder="Location (URL, path, section)" value={srcDraft.location} onChange={(e) => setSrcDraft({ ...srcDraft, location: e.target.value })} aria-label="Source location" />
          <button className="btn-secondary btn-sm" type="submit">Add source</button>
        </form>
      </Card>
    </div>
  );
}

function EditEntry({ entry, onSave, onCancel }: { entry: Entry; onSave: (p: Record<string, string>) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(entry.title);
  const [body, setBody] = useState(entry.body);
  const [category, setCategory] = useState(entry.category);
  return (
    <div className="space-y-2">
      <select className="input" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
        {Object.entries(CONTEXT_CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
      <textarea className="input" rows={5} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Content" />
      <p className="text-xs text-slate-500">Changing the text of a reviewed entry returns it to Unreviewed. Use “Mark reviewed” after verifying it again.</p>
      <div className="flex gap-2">
        <button className="btn-primary btn-sm" onClick={() => onSave({ title, body, category })}>Save</button>
        <button className="btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
