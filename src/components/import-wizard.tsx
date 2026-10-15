"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { apiFetch } from "@/lib/client-api";
import { FormError } from "@/components/form-error";
import { Alert, Card, OutcomeBadge } from "@/components/ui";
import { IMPORT_FIELDS, IMPORT_FIELD_LABEL, REQUIRED_FIELDS, type ColumnMapping, type ImportField, type ImportSummary } from "@/lib/import/fields";
import { OUTCOME_LABEL, type OutcomeValue } from "@/lib/domain";
import { formatDateOnly } from "@/lib/dates";
import { ContextSheetImport } from "@/components/context-sheet-import";

interface SheetInfo {
  name: string;
  headers: string[];
  rowCount: number;
  suggestedMapping: ColumnMapping;
}
interface InspectResult {
  fileName: string;
  fileType: "xlsx" | "csv";
  sheets: SheetInfo[];
}
interface PreviewRow {
  rowNumber: number;
  externalId: string;
  title: string;
  section: string | null;
  outcome: OutcomeValue;
  executedOn: string | null;
  testedBy: string | null;
  errors: string[];
  warnings: string[];
  incompleteCoverage: boolean;
  existing: null | { testCaseId: string; currentVersion: number; changedFields: string[]; resultInTargetCycle: string | null };
}
interface PreviewResult {
  summary: ImportSummary;
  sections: string[];
  rows: PreviewRow[];
}
interface CommitResult {
  batchId: string;
  cycleId: string;
  stats: Record<string, number>;
}

type Step = 1 | 2 | 3 | 4;

export function ImportWizard({
  appId,
  cycles,
  environments,
  existingCases,
}: {
  appId: string;
  cycles: { id: string; name: string; kind: string }[];
  environments: { id: string; name: string }[];
  existingCases: number;
}) {
  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [targetKind, setTargetKind] = useState<"new" | "existing">(cycles.length ? "existing" : "new");
  const [cycleId, setCycleId] = useState(cycles[0]?.id ?? "");
  const [newName, setNewName] = useState("Historical import");
  const [buildLabel, setBuildLabel] = useState("");
  const [environmentId, setEnvironmentId] = useState("");
  const [inspect, setInspect] = useState<InspectResult | null>(null);
  const [sheet, setSheet] = useState("");
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [dateOrder, setDateOrder] = useState<"DMY" | "MDY">("DMY");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [decisions, setDecisions] = useState<Record<string, "skip" | "update">>({});
  const [result, setResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [rowFilter, setRowFilter] = useState<"all" | "errors" | "warnings" | "duplicates" | "flags">("all");

  const sheetInfo = inspect?.sheets.find((s) => s.name === sheet) ?? null;

  function formData(extra: Record<string, string> = {}) {
    const fd = new FormData();
    fd.append("file", file!);
    fd.append("sheet", sheet);
    fd.append("mapping", JSON.stringify(mapping));
    fd.append("options", JSON.stringify({ dateOrder }));
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    return fd;
  }

  async function doInspect() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await apiFetch<InspectResult>(`/api/apps/${appId}/import/inspect`, { method: "POST", body: fd });
      setInspect(res);
      const preferred = res.sheets.find((s) => /test ?cases?/i.test(s.name)) ?? res.sheets[0];
      setSheet(preferred.name);
      setMapping(preferred.suggestedMapping);
      setStep(2);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function doPreview() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<PreviewResult>(`/api/apps/${appId}/import/preview`, {
        method: "POST",
        body: formData(targetKind === "existing" && cycleId ? { cycleId } : {}),
      });
      setPreview(res);
      const d: Record<string, "skip" | "update"> = {};
      for (const r of res.rows) if (r.existing) d[r.externalId] = decisions[r.externalId] ?? "skip";
      setDecisions(d);
      setStep(3);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function doCommit() {
    setBusy(true);
    setError(null);
    try {
      const target =
        targetKind === "existing"
          ? { kind: "existing", cycleId }
          : { kind: "new", name: newName, buildLabel: buildLabel || null, environmentId: environmentId || null };
      const res = await apiFetch<CommitResult>(`/api/apps/${appId}/import/commit`, {
        method: "POST",
        body: formData({ target: JSON.stringify(target), decisions: JSON.stringify(decisions) }),
      });
      setResult(res);
      setStep(4);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const duplicates = preview?.rows.filter((r) => r.existing) ?? [];
  const shownRows = useMemo(() => {
    const rows = preview?.rows ?? [];
    switch (rowFilter) {
      case "errors":
        return rows.filter((r) => r.errors.length);
      case "warnings":
        return rows.filter((r) => r.warnings.length);
      case "duplicates":
        return rows.filter((r) => r.existing);
      case "flags":
        return rows.filter((r) => r.incompleteCoverage);
      default:
        return rows;
    }
  }, [preview, rowFilter]);

  const steps = ["Destination & file", "Sheet & columns", "Preview", "Done"];

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap gap-2 text-sm" aria-label="Import steps">
        {steps.map((label, i) => (
          <li
            key={label}
            aria-current={step === i + 1 ? "step" : undefined}
            className={`rounded-full px-3 py-1 ${step === i + 1 ? "bg-navy-700 text-white" : step > i + 1 ? "bg-teal-100 text-teal-800" : "bg-slate-200 text-slate-600"}`}
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>
      <FormError error={error} />

      {step === 1 && (
        <Card title="1. Choose the destination cycle and file">
          <div className="grid gap-5 lg:grid-cols-2">
            <fieldset className="space-y-3">
              <legend className="label">Historical results go into</legend>
              {cycles.length > 0 && (
                <label className="flex items-start gap-2 text-sm">
                  <input type="radio" checked={targetKind === "existing"} onChange={() => setTargetKind("existing")} className="mt-1" />
                  <span className="flex-1">
                    An existing cycle
                    <select className="input mt-1" value={cycleId} onChange={(e) => setCycleId(e.target.value)} disabled={targetKind !== "existing"} aria-label="Existing cycle">
                      {cycles.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}{c.kind === "HISTORICAL_IMPORT" ? " (imported)" : ""}</option>
                      ))}
                    </select>
                  </span>
                </label>
              )}
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" checked={targetKind === "new"} onChange={() => setTargetKind("new")} className="mt-1" />
                <span className="flex-1 space-y-2">
                  A new historical cycle
                  <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} disabled={targetKind !== "new"} aria-label="New cycle name" placeholder="Cycle name" />
                  <input className="input" value={buildLabel} onChange={(e) => setBuildLabel(e.target.value)} disabled={targetKind !== "new"} aria-label="Build label" placeholder="Build / release label (leave blank if unknown)" />
                  <select className="input" value={environmentId} onChange={(e) => setEnvironmentId(e.target.value)} disabled={targetKind !== "new"} aria-label="Environment">
                    <option value="">Environment: not recorded</option>
                    {environments.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </span>
              </label>
              <p className="text-xs text-slate-500">
                Completed results (Pass/Fail/Blocked/N/A) become imported historical attempts with unknown build and execution method. Not run rows get no attempt.
              </p>
            </fieldset>
            <div className="space-y-3">
              <label className="label" htmlFor="import-file">File (.xlsx or .csv)</label>
              <input id="import-file" type="file" accept=".xlsx,.csv" className="input" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              {existingCases > 0 && (
                <Alert kind="info">This application already has {existingCases} cases. Matching case IDs will be listed for an explicit skip or reviewed update.</Alert>
              )}
              <button className="btn-primary" disabled={!file || busy || (targetKind === "new" && !newName.trim()) || (targetKind === "existing" && !cycleId)} onClick={doInspect}>
                {busy ? "Reading file…" : "Next: map columns"}
              </button>
            </div>
          </div>
        </Card>
      )}

      {step === 2 && inspect && sheetInfo && (
        <Card title={`2. Sheet and column mapping · ${inspect.fileName}`}>
          <div className="mb-4 grid gap-3 md:grid-cols-3">
            {inspect.fileType === "xlsx" && (
              <div>
                <label className="label" htmlFor="sheet">Sheet</label>
                <select
                  id="sheet"
                  className="input"
                  value={sheet}
                  onChange={(e) => {
                    setSheet(e.target.value);
                    setMapping(inspect.sheets.find((s) => s.name === e.target.value)?.suggestedMapping ?? {});
                  }}
                >
                  {inspect.sheets.map((s) => <option key={s.name} value={s.name}>{s.name} ({s.rowCount} rows)</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="label" htmlFor="dateorder">Text dates are</label>
              <select id="dateorder" className="input" value={dateOrder} onChange={(e) => setDateOrder(e.target.value as "DMY" | "MDY")}>
                <option value="DMY">Day/Month/Year (e.g. 02/10/2026 = 2 Oct)</option>
                <option value="MDY">Month/Day/Year</option>
              </select>
              <p className="mt-1 text-xs text-slate-500">Real Excel date cells are read exactly, with no timezone shift.</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>Kairos Tester field</th><th>Source column</th></tr>
              </thead>
              <tbody>
                {IMPORT_FIELDS.map((f: ImportField) => (
                  <tr key={f}>
                    <td>
                      {IMPORT_FIELD_LABEL[f]} {REQUIRED_FIELDS.includes(f) && <span className="text-red-700">(required)</span>}
                    </td>
                    <td>
                      <select
                        className="input max-w-sm"
                        value={mapping[f] ?? ""}
                        onChange={(e) => setMapping({ ...mapping, [f]: e.target.value === "" ? null : Number(e.target.value) })}
                        aria-label={`Column for ${IMPORT_FIELD_LABEL[f]}`}
                      >
                        <option value="">— not mapped —</option>
                        {sheetInfo.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Rows with only one filled cell and no title are treated as section headings: their names are kept, but they are not imported as cases.
          </p>
          <div className="mt-4 flex gap-2">
            <button className="btn-secondary" onClick={() => setStep(1)}>Back</button>
            <button className="btn-primary" disabled={busy} onClick={doPreview}>{busy ? "Parsing…" : "Next: preview"}</button>
          </div>
          {inspect.fileType === "xlsx" && inspect.sheets.length > 1 && file && (
            <div className="mt-6 border-t border-slate-200 pt-4">
              <ContextSheetImport appId={appId} file={file} sheets={inspect.sheets.map((s) => s.name).filter((n) => n !== sheet)} />
            </div>
          )}
        </Card>
      )}

      {step === 3 && preview && (
        <>
          <Card title="3. Preview (nothing saved yet)">
            <div className="grid gap-3 text-sm md:grid-cols-4">
              <div><p className="label">Cases found</p><p className="text-xl font-semibold">{preview.summary.totalCases}</p></div>
              <div><p className="label">Valid / with errors</p><p className="text-xl font-semibold">{preview.summary.validCases} / <span className={preview.summary.errorRows ? "text-red-700" : ""}>{preview.summary.errorRows}</span></p></div>
              <div><p className="label">Sections</p><p className="text-xl font-semibold">{preview.summary.sections}</p></div>
              <div><p className="label">Already in application</p><p className="text-xl font-semibold">{duplicates.length}</p></div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-sm">
              {(Object.keys(preview.summary.byOutcome) as OutcomeValue[]).map((o) => (
                <span key={o} className="flex items-center gap-1"><OutcomeBadge outcome={o} /> {preview.summary.byOutcome[o]}</span>
              ))}
              <span className="ml-2 text-orange-900">⚑ {preview.summary.incompleteCoverage} Pass result(s) with notes indicating incomplete testing</span>
            </div>
            <p className="mt-2 text-xs text-slate-500">Counts come from the parsed rows themselves; cached Summary-sheet cells are ignored.</p>
            {preview.summary.errorRows > 0 && (
              <div className="mt-3">
                <Alert kind="warning" title={`${preview.summary.errorRows} row(s) have errors and will NOT be imported.`}>
                  They are recorded in the import log for provenance. Fix the file and re-import them later if needed.
                </Alert>
              </div>
            )}
            {duplicates.length > 0 && (
              <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
                <p className="font-semibold text-amber-900">{duplicates.length} case ID(s) already exist in this application.</p>
                <p className="text-amber-900">
                  Default is <strong>Skip</strong> (no change to the case or its results). <strong>Update</strong> creates a new case version if content differs, and adds the
                  imported result as a new attempt; earlier versions and attempts are kept.
                </p>
                <div className="mt-2 flex gap-2">
                  <button className="btn-secondary btn-sm" onClick={() => setDecisions(Object.fromEntries(duplicates.map((d) => [d.externalId, "skip"])))}>Skip all</button>
                  <button className="btn-secondary btn-sm" onClick={() => setDecisions(Object.fromEntries(duplicates.map((d) => [d.externalId, "update"])))}>Update all (reviewed)</button>
                </div>
              </div>
            )}
          </Card>

          <Card
            title="Rows"
            actions={
              <select className="input w-auto" value={rowFilter} onChange={(e) => setRowFilter(e.target.value as typeof rowFilter)} aria-label="Row filter">
                <option value="all">All rows ({preview.rows.length})</option>
                <option value="errors">Errors ({preview.rows.filter((r) => r.errors.length).length})</option>
                <option value="warnings">Warnings ({preview.rows.filter((r) => r.warnings.length).length})</option>
                <option value="duplicates">Existing IDs ({duplicates.length})</option>
                <option value="flags">Incomplete-testing flags ({preview.summary.incompleteCoverage})</option>
              </select>
            }
          >
            <div className="max-h-[60vh] overflow-auto">
              <table className="table-base">
                <thead className="sticky top-0">
                  <tr><th>Row</th><th>ID</th><th>Title / section</th><th>Result</th><th>Date</th><th>Tester</th><th>Messages</th><th>Existing case</th></tr>
                </thead>
                <tbody>
                  {shownRows.map((r) => (
                    <tr key={r.rowNumber} className={r.errors.length ? "bg-red-50/60" : ""}>
                      <td className="text-xs text-slate-500">{r.rowNumber}</td>
                      <td className="whitespace-nowrap font-medium">{r.externalId || "—"}</td>
                      <td className="min-w-56">{r.title || "—"}<div className="text-xs text-slate-500">{r.section ?? "no section"}</div></td>
                      <td><OutcomeBadge outcome={r.outcome} /></td>
                      <td className="whitespace-nowrap text-xs">{r.executedOn ? formatDateOnly(r.executedOn) : "—"}</td>
                      <td className="text-xs">{r.testedBy ?? "—"}</td>
                      <td className="max-w-md text-xs">
                        {r.errors.map((m, i) => <p key={i} className="text-red-800">✕ {m}</p>)}
                        {r.warnings.map((m, i) => <p key={i} className="text-amber-900">! {m}</p>)}
                      </td>
                      <td className="text-xs">
                        {r.existing ? (
                          <div className="space-y-1">
                            <p>v{r.existing.currentVersion}; {r.existing.changedFields.length ? `differs: ${r.existing.changedFields.join(", ")}` : "same content"}</p>
                            {r.existing.resultInTargetCycle && <p>In target cycle: {OUTCOME_LABEL[r.existing.resultInTargetCycle as OutcomeValue]}</p>}
                            <select
                              className="input"
                              value={decisions[r.externalId] ?? "skip"}
                              onChange={(e) => setDecisions({ ...decisions, [r.externalId]: e.target.value as "skip" | "update" })}
                              aria-label={`Decision for ${r.externalId}`}
                            >
                              <option value="skip">Skip</option>
                              <option value="update">Update (reviewed)</option>
                            </select>
                          </div>
                        ) : (
                          <span className="text-slate-400">new</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button className="btn-secondary" onClick={() => setStep(2)}>Back</button>
              <button className="btn-accent" disabled={busy || preview.summary.validCases === 0} onClick={doCommit}>
                {busy ? "Importing…" : `Confirm import of ${preview.summary.validCases} valid row(s)`}
              </button>
              <span className="text-xs text-slate-500">Saved in one transaction: either everything is saved or nothing is.</span>
            </div>
          </Card>
        </>
      )}

      {step === 4 && result && (
        <Card title="4. Import complete">
          <Alert kind="success" title="Import saved.">The original rows and file details are kept as provenance.</Alert>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
            {Object.entries({
              "Cases created": result.stats.casesCreated,
              "Cases updated (new version)": result.stats.casesUpdated,
              "Updated, content unchanged": result.stats.casesUnchanged,
              "Skipped (existing)": result.stats.casesSkipped,
              "Rows with errors": result.stats.errorRows,
              "Historical attempts created": result.stats.attemptsCreated,
              "Results already recorded": result.stats.resultsAlreadyRecorded,
              "Not run (no attempt)": result.stats.notRun,
              "Incomplete-coverage flags": result.stats.incompleteCoverageFlags,
              Sections: result.stats.sections,
            }).map(([k, v]) => (
              <div key={k} className="rounded bg-slate-50 p-2"><dt className="text-xs text-slate-500">{k}</dt><dd className="text-lg font-semibold">{v}</dd></div>
            ))}
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link className="btn-primary" href={`/apps/${appId}?cycle=${result.cycleId}`}>View overview</Link>
            <Link className="btn-secondary" href={`/apps/${appId}/cycles/${result.cycleId}`}>Open the cycle</Link>
            <Link className="btn-secondary" href={`/apps/${appId}/cases`}>Browse cases</Link>
          </div>
        </Card>
      )}
    </div>
  );
}
