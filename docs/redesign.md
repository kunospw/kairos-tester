# Kairos Tester: architecture review and low-friction redesign

Status: phase 1 and the UI redesign (section 6) are implemented. The rest of phases 2 to 4 are proposals.

## 1. How it works today

```
 Browser (tester)                         Tester's laptop
 ┌──────────────────────┐                 ┌────────────────────────────────────┐
 │ Next.js pages        │                 │ AI runner  (npm run runner)        │
 │  src/app/(app)       │                 │  runner/index.ts  claim → run loop │
 └─────────┬────────────┘                 │  runner/agent.ts  AI action loop   │
           │ fetch /api/*                 │  runner/browser.ts guarded browser │
 ┌─────────▼────────────┐                 └──────┬───────────────┬─────────────┘
 │ API routes           │                        │ Prisma        │ Playwright
 │  src/app/api         │                        │ (same DB)     ▼
 └─────────┬────────────┘                        │        App under test
 ┌─────────▼────────────────────────────┐        │        (localhost only)
 │ Services  src/server/services        │◄───────┘
 │  run, execution, ai, recipe, import, │        Ollama Cloud
 │  report, attention ...               │──────► (drafting, reviews,
 └─────────┬────────────────────────────┘         summaries, agent loop)
           ▼
       PostgreSQL  +  evidence folder
```

Core data:

| Area | Models |
|---|---|
| What to test | `Application` → `TestCase` → immutable `TestCaseVersion` |
| Where | `Environment` with an `agentProfile` (sign-in, roles, protected names, upload folders) |
| Results | `TestCycle` → `CycleCase` → `ExecutionAttempt` → `StepOutcome`, `Evidence` |
| AI runs | `TestRun` → `RunItem` → `HumanRequest`, `RunEvent`; `RunnerStatus` heartbeat |
| AI suggestions | `AiProposal` → `AiProposalItem` → accepted into versions, findings, `Recipe`s |

**What is already good and should stay:** a clean services layer that both the web
app and the runner call (one place for the rules, well covered by DB tests);
immutable case versions and attempts; AI output that is always a proposal; run
planning that is deterministic and explains itself; a runner that enforces safety
itself (localhost only, protected names, upload folders) instead of trusting the AI.

The friction is not in the architecture. It is in how the workflow is spread over
the UI.

## 2. Where the friction is

The tester's real loop is **run → answer what the AI couldn't settle → report**.
Ranked by how much each problem gets in the way of that loop:

| # | Problem | Effect on the user | Phase 1 |
|---|---|---|---|
| 1 | Decisions were spread over three places: the run page's "Needs you", the Review inbox, and AI proposals under Context & AI. Worse, deciding a result in the Review inbox left the run page's card open, and clicking it then failed with *"There is no open AI attempt to decide on."* | Hunting for work; seeing the same item twice; an error on a correct action | **Fixed**: one *Needs you* inbox; a decision anywhere closes it everywhere |
| 2 | The AI's mid-run questions wait 60 s, and were only visible on that run's page. | Questions time out unseen, cases park, re-runs needed | **Improved**: badge on every page (refreshed every 10 s and on navigation) |
| 3 | The runner was invisible until after a run started. Both settings pages still said *"Runner: Not connected"* and called it unimplemented. | Start a run, wait, then find out a second program is needed | **Fixed**: runner indicator on every page, warning before starting, real status in Setup |
| 4 | AI setup only appeared for the first environment, only while none was set up, and could never be edited. Saving the form would also have wiped settings it didn't show (protected names, upload folders, auto-dismiss buttons, custom labels). | Stuck with the first answers; a second environment impossible; safety rules silently lost | **Fixed**: editable AI setup for every environment; hidden settings kept; protected names and upload folders editable |
| 5 | Eight tabs and overlapping concepts: Overview vs Cycles, "cycle" vs "round" vs "run", Context & AI mixing knowledge, drafting, review and history. | Hard to know where to go next | **Improved**: 6 tabs in loop order (below) |
| 6 | Configuration lives in `.env` and needs a restart; the runner needs a second terminal. | Setup work outside the app | Proposed (phases 2 and 3) |
| 7 | `.gitignore` had `storage/`, which also ignored `src/server/storage/`, so `evidence-storage.ts` was never committed. A fresh clone does not compile. | Nobody else can run the project | **Ignore rule fixed**; the file itself still has to be committed from the original machine |
| 8 | README and `docs/runner-interface.md` describe a design that differs from what was built. | Misleading for new users | README updated; runner doc marked as superseded |

## 3. Target design

**Principle:** the loop (run → answer → report) is always one click away; setup is
done once, then gets out of the way; nothing waits for the user without telling them.

Navigation (phase 1, done):

```
▶ Run tests   Needs you (3)   Results   Test cases   Reports   Setup        ● AI runner on
```

| Before | After |
|---|---|
| ▶ Run tests | ▶ Run tests (warns up front if the runner is off) |
| Review inbox, plus the run page's "Needs you", plus pending AI proposals | **Needs you**: questions from the AI, results to confirm, AI suggestions (optional), with a live count |
| Overview, Cycles & execution | **Results** (the overview), with an *All cycles* link |
| Test cases | Test cases, with a *Draft with AI* button |
| Reports | Reports |
| App settings, Context & AI | **Setup**: readiness checklist, environments, AI setup per environment, runner, link to knowledge & AI drafting, import history |

## 4. Next phases (proposed)

### Phase 2: fewer steps per run
- **One command starts everything.** `npm run app` launches the web app and the
  runner together (a small Node launcher; no new dependency), so the second terminal
  goes away. Keep `npm run runner` for running them separately.
- **Faster confirming.** Done: keyboard shortcuts (P/F/B/N). Still proposed: "confirm
  all as suggested" for a selection. Confirming results one by one is the biggest time
  cost after a long run.
- **Don't miss questions.** Done: desktop notification and tab-title count. Still
  proposed: make the wait (`RUNNER_ASK_WAIT_MS`) a per-environment setting.
- **Repeat in one click.** "Run again" and "Retest failures" on a finished run.
- **Report draft on finish.** Create the draft report automatically when a run ends.

### Phase 3: setup without editing files
- AI key and model stored in the database (encrypted with a key from `.env`) and
  edited in Settings with *Test connection*, without a restart.
- *Test sign-in* in AI setup: the runner signs in once and shows a screenshot, so a
  wrong profile is caught before a full run.
- A short guided start for a new application: name → import → environment → AI
  setup → test sign-in → first run. The Setup checklist is the first step of this.

### Phase 4: one vocabulary, clear homes
- One word for a round of testing everywhere in the UI ("cycle" in data, chosen label
  in the UI).
- Split Context & AI: knowledge under Setup (where it is now linked from), drafting
  under Test cases, results review under Results.
- Rewrite `docs/runner-interface.md` to describe `runner/` as built (direct DB
  access via the services layer, `RunnerStatus` heartbeat). Move to the HTTP design
  only if the runner ever needs to run on a different machine from the database.

## 5. Phase 1 changes (this PR)

- `src/server/services/attention-service.ts`: one definition of what needs a person
  (`attentionCounts`, `inbox`) and of runner status (`runnerStatus`), used by the
  nav badge, the inbox, the run pages and Setup.
- `completeAttempt` now also closes an AI run's `CONFIRM_RESULT` request, so deciding
  in the inbox or on the attempt page clears the run page too (DB test added).
- New `/apps/:id/inbox` (*Needs you*); `/review` redirects there. `AskCard` is shared
  by the inbox and the live run page.
- `GET /api/apps/:id/attention`, polled by the navigation for the badge and runner
  indicator.
- Setup page with a readiness checklist and AI setup for every environment;
  `AgentSetupForm` keeps settings it doesn't display.
- Stale "Not connected" runner text replaced with real status; README updated.
- `.gitignore`: `storage/` → `/storage/`.

## 6. UI redesign and "nothing is skipped" (implemented)

Researched against TestRail's run/results model, Linear's sidebar, inbox and keyboard
patterns, Carbon / Dynatrace status guidance (shape + colour + label, never colour alone),
and published lists of generic "AI-generated UI" tells. The resulting rules are in
`docs/design.md`.

- **Sidebar shell** with an app switcher, the loop-ordered nav with the Needs you count,
  runner status, notifications and account. With one application, `/` opens it directly.
- **Results** leads with one next step, one status bar, a single "needs attention" list
  (empty groups hidden) and per-section progress.
- **Run tests** is three steps: where, what, start (with a one-line plan summary).
- **Live run** shows the application live beside the results (runner screencast →
  `RunnerStatus.frame` → `GET /api/apps/:id/runs/:runId/live`), and can stop a run.
- **Needs you** is keyboard-driven (P / F / B / N on the top result), and every item
  can be handed back to the AI.
- **One word for a round of testing**: "round" throughout the UI (`TestCycle` in data).
- **Runner behaviour**: questions park after `RUNNER_ASK_WAIT_MS` (15 s) without
  recording a result; prerequisites make a case `WAITING` instead of skipped
  (`src/server/services/run-waiting.ts`); the `recheck` action re-queues any request so the
  AI revisits it, and a confirmed failure is kept as history before the re-test.
- Migration `20261015130000_live_view_waiting`: `RunItemStatus.WAITING` and the live-frame
  columns on `RunnerStatus`.
