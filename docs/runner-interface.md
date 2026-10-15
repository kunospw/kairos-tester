# Future local automation runner — interface design

**Status: superseded.** The runner that was built (`runner/`, started with
`npm run runner`) is a local AI runner that uses the services layer and the
database directly, with a `RunnerStatus` heartbeat, instead of the HTTP API
below. This document is kept as the design to follow if the runner ever has to
run on a different machine from the database. See `docs/redesign.md`. Kairos
Tester still never executes uploaded or arbitrary scripts.

## Why a separate runner

- Browser automation is long-running and must not run inside Next.js request
  handlers.
- Target applications (e.g. KFastTrack on `http://localhost:3000`) are reachable
  from the tester's laptop, not necessarily from wherever Kairos Tester runs.
- A written test case is **not** executable. Automation requires a reviewed
  script (a committed Playwright spec) bound to a specific case version.

The runner is therefore a small local Node.js process (e.g. `kt-runner`) started
by the tester on their laptop. It pulls jobs from Kairos Tester, runs a
pre-reviewed Playwright spec from a local repository checkout, and pushes
results and evidence back.

```
 Kairos Tester (Next.js + PostgreSQL)            Tester's laptop
 ┌──────────────────────────────┐   HTTPS/JSON   ┌───────────────────────────┐
 │ /api/runner/* (future)       │ <────────────> │ kt-runner (Node.js)       │
 │  jobs, events, results,      │                │  └─ Playwright (local)    │
 │  evidence, heartbeat         │                │      └─ target app        │
 └──────────────────────────────┘                │         (localhost:3000)  │
                                                 └───────────────────────────┘
```

## Data already in place

| Concept | Where |
|---|---|
| Runner reference per case | `AutomationBinding` (`runnerType`, `externalTestId`, `scriptRef`, `reviewedBy/At`) |
| Case version the script was reviewed against | to be added: `AutomationBinding.reviewedVersionId` |
| Execution record | `ExecutionAttempt` with `source = RUNNER`, `executionMethod = AUTOMATED / HYBRID` |
| Step outcomes | `StepOutcome` |
| Evidence | `Evidence` via the `EvidenceStorage` interface |

## Proposed endpoints (future)

All under `/api/runner`, authenticated with a per-runner token (separate from the
tester's browser session; stored hashed, revocable, scoped to one or more
applications). Tokens are created in Settings → Integrations.

### 1. Register / heartbeat
`POST /api/runner/heartbeat`
```json
{ "runnerId": "laptop-dyah", "version": "0.1.0", "capabilities": ["playwright-chromium"],
  "activeJobId": "job_123" }
```
- Sent every 30 s. A runner with no heartbeat for 2 minutes is shown as
  *Disconnected*; its running job is marked `RUNNER_LOST` and the attempt moves
  to `AWAITING_REVIEW` (never Pass).

### 2. Job pickup
`POST /api/runner/jobs/claim` → `200 { job }` or `204` when nothing is queued.
```json
{
  "jobId": "job_123",
  "leaseExpiresAt": "2026-10-14T05:10:00Z",
  "application": { "id": "app_1", "name": "KFastTrack" },
  "environment": { "id": "env_demo", "name": "Demo", "targetUrl": "http://localhost:3000" },
  "cycleCaseId": "cc_9",
  "caseVersion": { "id": "ver_3", "externalId": "SI-01", "versionNumber": 3, "steps": [...] },
  "binding": { "runnerType": "playwright-local", "externalTestId": "SI-01 sign in with code",
               "scriptRef": "kfasttrack-e2e@3f2a1c:tests/sign-in.spec.ts" }
}
```
Rules:
- Jobs are only created for cases whose binding is **reviewed against the exact
  case version** in the cycle. If the case has a newer version, the job is refused
  until the binding is re-reviewed.
- Claiming is atomic (`UPDATE … WHERE status = 'QUEUED' … RETURNING`), so two
  runners cannot take the same job. The lease must be renewed by heartbeat.
- The runner resolves `scriptRef` against a **local, already-reviewed checkout**.
  It never downloads or executes code sent by the server.

### 3. Progress events
`POST /api/runner/jobs/{jobId}/events`
```json
{ "seq": 4, "type": "STEP_FINISHED", "stepIndex": 1, "result": "PASS", "at": "…", "message": "…" }
```
- `seq` is monotonic per job; duplicates (same `seq`) are ignored.

### 4. Evidence upload
`POST /api/runner/jobs/{jobId}/evidence` (multipart, same validation as manual
uploads: content sniffing, size limit, generated storage names).
- Header `Idempotency-Key: <sha256 of file>` so a retried upload is stored once.

### 5. Result submission
`POST /api/runner/jobs/{jobId}/result`
```json
{ "idempotencyKey": "job_123:final", "outcome": "PASS" | "FAIL" | "BLOCKED",
  "stepOutcomes": [ { "stepIndex": 0, "result": "PASS", "note": "…" } ],
  "actualResult": "…", "durationMs": 48211, "playwrightVersion": "1.x" }
```
- **Duplicate handling:** the first accepted submission wins; a repeat with the
  same `idempotencyKey` returns the original response; a different payload for
  an already-finished job returns `409`.
- Creates/updates one `ExecutionAttempt` (`source = RUNNER`,
  `executionMethod = AUTOMATED`, `buildLabel` from the cycle).
- **Hybrid cases:** the attempt goes to `AWAITING_REVIEW`, not `COMPLETED`. A
  human must confirm the checkpoints in the UI. Automated actions alone never
  pass a hybrid case.
- Automated Pass still needs every required check to be passed (same rule as
  manual execution).

### 6. Failure and cancellation
- `POST /api/runner/jobs/{jobId}/fail` with `{ "reason": "…", "category": "SCRIPT_ERROR" | "ENVIRONMENT" | "TIMEOUT" }`
  → the attempt is recorded as **Blocked** (execution problem), not Fail
  (application failure), unless the script reported an assertion failure.
- Cancellation is requested from the UI (`CANCEL_REQUESTED`); the runner sees it
  in the heartbeat response, stops Playwright, uploads partial evidence, and
  calls `/fail` with `category: "CANCELLED"`.
- Lease expiry without result → job `RUNNER_LOST`, attempt `AWAITING_REVIEW`.

## Security notes

- Runner tokens are distinct from the tester session, hashed at rest, and scoped
  per application.
- The runner only executes specs from a local checkout the tester reviewed; the
  server sends identifiers, never code.
- Target credentials stay on the laptop (e.g. Playwright storage state files);
  they are never sent to Kairos Tester or to the AI provider.
- Simulated runs (already implemented, for demos) live only in *Simulation*
  cycles and are flagged `isSimulated`; real runner results are never written to
  simulation cycles and vice versa.

## Keeping this separate from app smoke tests

`scripts/smoke.mjs` is a smoke check **of Kairos Tester itself**. It never
contacts KFastTrack. Any future KFastTrack automation belongs in the runner and
its own reviewed spec repository.
