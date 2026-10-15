// End-to-end API smoke check of Kairos Tester itself (never contacts KFastTrack).
// Walks: auth guard -> login -> create app -> import -> cycle -> execute + evidence
//        -> retest -> report snapshot -> CSV -> logout -> evidence locked again.
//
// Usage (PowerShell, with the app running):
//   $env:KT_SMOKE_PASSWORD = "<tester password>"
//   $env:KT_SMOKE_WORKBOOK = "C:\path\to\checklist.xlsx"   # optional; defaults to the CSV template
//   npm run smoke
// It creates an application named "Smoke test <timestamp>" in the working database.

import fs from "node:fs";
import path from "node:path";

const BASE = process.env.KT_BASE_URL ?? "http://localhost:3100";
const USER = process.env.KT_SMOKE_USER ?? process.env.TESTER_USERNAME ?? "tester";
const PASSWORD = process.env.KT_SMOKE_PASSWORD;
const WORKBOOK = process.env.KT_SMOKE_WORKBOOK;
if (!PASSWORD) {
  console.error("Set KT_SMOKE_PASSWORD to the tester password.");
  process.exit(2);
}

let cookie = "";
let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg) => {
  failures++;
  console.log(`  ✗ ${msg}`);
};
const check = (cond, msg, extra = "") => (cond ? ok(msg) : fail(`${msg} ${extra}`));

async function req(method, url, { json, form, raw = false, redirect = "follow" } = {}) {
  const headers = { Origin: BASE };
  if (cookie) headers.Cookie = cookie;
  let body;
  if (json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form) body = form;
  const res = await fetch(BASE + url, { method, headers, body, redirect });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  if (raw) return res;
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

console.log(`Kairos Tester smoke check against ${BASE}`);

console.log("Auth guard");
check((await req("GET", "/api/evidence/nope")).status === 401, "evidence route requires sign-in");
const home = await req("GET", "/", { raw: true, redirect: "manual" });
check([302, 307, 308].includes(home.status) && (home.headers.get("location") ?? "").includes("/login"), "pages redirect to /login when signed out");
check((await req("POST", "/api/auth/login", { json: { username: USER, password: "definitely-wrong" } })).status === 401, "wrong password rejected");
const login = await req("POST", "/api/auth/login", { json: { username: USER, password: PASSWORD } });
check(login.status === 200 && cookie.startsWith("kt_session="), "login sets session cookie", JSON.stringify(login.data));
if (login.status !== 200) process.exit(1);

console.log("Import");
const app = await req("POST", "/api/apps", { json: { name: `Smoke test ${new Date().toISOString()}`, description: "Created by scripts/smoke.mjs" } });
check(app.status === 200, "application created");
const appId = app.data.id;

let fileName, bytes;
if (WORKBOOK) {
  fileName = path.basename(WORKBOOK);
  bytes = fs.readFileSync(WORKBOOK);
} else {
  const t = await req("GET", "/api/import/template", { raw: true });
  fileName = "template.csv";
  bytes = Buffer.from(await t.arrayBuffer());
}
const fileForm = () => {
  const f = new FormData();
  f.append("file", new Blob([bytes]), fileName);
  return f;
};
const inspect = await req("POST", `/api/apps/${appId}/import/inspect`, { form: fileForm() });
check(inspect.status === 200, `inspect ${fileName}`, JSON.stringify(inspect.data));
const sheet = inspect.data.sheets.find((s) => /test ?cases?/i.test(s.name)) ?? inspect.data.sheets[0];
const withMapping = () => {
  const f = fileForm();
  f.append("sheet", sheet.name);
  f.append("mapping", JSON.stringify(sheet.suggestedMapping));
  f.append("options", JSON.stringify({ dateOrder: "DMY" }));
  return f;
};
const preview = await req("POST", `/api/apps/${appId}/import/preview`, { form: withMapping() });
check(preview.status === 200, "preview", JSON.stringify(preview.data));
if (preview.status !== 200) process.exit(1);
const s = preview.data.summary;
console.log(`    preview: ${s.totalCases} cases, ${s.sections} sections, ${JSON.stringify(s.byOutcome)}, errors ${s.errorRows}, incomplete flags ${s.incompleteCoverage}`);
const commitForm = withMapping();
commitForm.append("target", JSON.stringify({ kind: "new", name: "Historical import (smoke)" }));
commitForm.append("decisions", "{}");
const commit = await req("POST", `/api/apps/${appId}/import/commit`, { form: commitForm });
check(commit.status === 200 && commit.data.stats.casesCreated === s.validCases, "commit saved all valid cases", JSON.stringify(commit.data));

console.log("Execute, evidence, retest");
const cycle = await req("POST", `/api/apps/${appId}/cycles`, { json: { name: "Smoke cycle", kind: "STANDARD", buildLabel: "smoke-1", include: { mode: "all" } } });
check(cycle.status === 200, "cycle created (all Not run)");
// Find a cycle case id via the cycle page HTML is brittle; use the run route by starting the first case.
const cyclePage = await req("GET", `/apps/${appId}/cycles/${cycle.data.id}`, { raw: true });
const html = await cyclePage.text();
const ccId = html.match(/\/run\/([a-z0-9]+)/)?.[1];
check(Boolean(ccId), "cycle page lists cases");
const a1 = await req("POST", `/api/cycle-cases/${ccId}/attempts`);
check(a1.status === 200 && a1.data.attempt.attemptNumber === 1, "attempt 1 started");
const ev = new FormData();
ev.append("file", new Blob([PNG], { type: "image/png" }), "smoke.png");
ev.append("caption", "smoke evidence");
const up = await req("POST", `/api/attempts/${a1.data.attempt.id}/evidence`, { form: ev });
check(up.status === 200, "evidence uploaded");
const badPass = await req("POST", `/api/attempts/${a1.data.attempt.id}/complete`, { json: { outcome: "PASS", tester: "smoke" } });
check(badPass.status === 400, "Pass refused while required checks unfinished");
const c1 = await req("POST", `/api/attempts/${a1.data.attempt.id}/complete`, { json: { outcome: "FAIL", outcomeReason: "Smoke: simulated defect note", tester: "smoke" } });
check(c1.status === 200 && c1.data.status === "COMPLETED", "attempt 1 completed as Fail with reason");
const a2 = await req("POST", `/api/cycle-cases/${ccId}/attempts`);
check(a2.status === 200 && a2.data.attempt.attemptNumber === 2, "retest creates attempt 2");
const c2 = await req("POST", `/api/attempts/${a2.data.attempt.id}/complete`, { json: { outcome: "BLOCKED", outcomeReason: "Smoke: environment unavailable", tester: "smoke" } });
check(c2.status === 200, "attempt 2 completed as Blocked");

console.log("Report");
const report = await req("POST", `/api/apps/${appId}/reports`, { json: { cycleId: cycle.data.id, title: "Smoke report" } });
check(report.status === 200, "report snapshot created");
const csv = await req("GET", `/api/apps/${appId}/reports/${report.data.id}/csv`, { raw: true });
const csvText = await csv.text();
check(csv.status === 200 && csvText.includes("Case ID"), "CSV export");
const page = await req("GET", `/apps/${appId}/reports/${report.data.id}`, { raw: true });
check(page.status === 200 && (await page.text()).includes("Customer acceptance"), "report preview renders");
const evGet = await req("GET", `/api/evidence/${up.data.id}`, { raw: true });
check(evGet.status === 200 && evGet.headers.get("content-type") === "image/png", "evidence downloads when signed in");

console.log("Logout");
await req("POST", "/api/auth/logout");
cookie = "";
check((await req("GET", `/api/evidence/${up.data.id}`)).status === 401, "evidence locked after logout");

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll smoke checks passed");
process.exit(failures ? 1 : 0);
