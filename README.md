# Kairos Tester

AI-assisted QA/UAT test management prototype for Kairos Business Solutions.

Plan tests, import existing checklists with their history, record manual and hybrid
executions with evidence, retest without losing history, and produce
customer-friendly report snapshots. AI (Ollama Cloud) drafts cases, reviews results
and drafts summaries, but **only as proposals that a person accepts or rejects**.

Kairos Tester is separate from the applications it tests. It stores cases, results,
evidence and reports. The web app never contacts the application under test (for
example KFastTrack). AI test runs are executed by a separate local **AI runner**
(`npm run runner`) that drives a browser against `localhost` only (see section 8).

---

## 1. Prerequisites (Windows)

| Tool | Version used | Check |
|---|---|---|
| Node.js | 20.19+ (built with 24.19) | `node -v` |
| npm | 10+ (built with 11.17) | `npm -v` |
| PostgreSQL | 16+ (built for 18) | via Docker **or** an existing server |
| Docker Desktop (optional) | 4.x | `docker version` |

All commands below are for **Windows PowerShell**, run from the project folder:

```powershell
cd "D:\Dee's archivest\projects\Kairos\KTesters\kairos-tester"
```

## 2. Install

```powershell
npm ci
```

`npm ci` also runs `prisma generate`. npm 11 asks before running install scripts.
This project allows only Prisma's own engine download (`allowScripts` in
`package.json`).

## 3. Configure `.env`

```powershell
Copy-Item .env.example .env
notepad .env
```

Fill in at least:

* `POSTGRES_PASSWORD`: a strong password (used by Docker Compose).
* `DATABASE_URL` and `TEST_DATABASE_URL`: same password. The test database must be a
  **separate** database whose name contains `test`; the DB tests delete its data.
* `TESTER_USERNAME`, `TESTER_DISPLAY_NAME`, `TESTER_PASSWORD_HASH`. Generate the hash:

```powershell
npm run hash-password
# type the password twice (min 10 chars), then paste the printed
# TESTER_PASSWORD_HASH="scrypt:..." line into .env
```

There is no default account. Sign-in is refused until both values are set.
`.env` is git-ignored; never commit it.

## 4. Start PostgreSQL

### Option A: Docker Compose (recommended)

Start **Docker Desktop** and wait for "Engine running", then:

```powershell
docker compose up -d
docker compose ps        # STATUS should become "healthy"
```

This runs `postgres:18`, bound to `127.0.0.1:5432` only, with data in the named
volume `kairos_tester_pgdata`. On first start it also creates the disposable
`kairos_tester_test` database (`docker/init/01-test-db.sql`).

If Docker Desktop reports *"Docker Desktop is unable to start"* (WSL `vpnkit-bridge
handshake failed`): quit Docker Desktop, run `wsl --shutdown`, start Docker Desktop
again. If it still fails, restart Windows.

### Option B: an existing PostgreSQL server

Create two databases (working and test) and point `DATABASE_URL` /
`TEST_DATABASE_URL` at them, for example:

```sql
CREATE USER kairos WITH PASSWORD '...';
CREATE DATABASE kairos_tester OWNER kairos;
CREATE DATABASE kairos_tester_test OWNER kairos;
```

## 5. Create the schema

```powershell
npm run db:deploy        # applies committed migrations in prisma/migrations
npm run db:status        # should say "Database schema is up to date"
```

`db:deploy` only applies migrations; it never resets or deletes data. (During
development, `npm run db:migrate` creates a new migration after editing
`prisma/schema.prisma`.)

## 6. Run

```powershell
npm run dev              # development: http://localhost:3100
# or production mode:
npm run build
npm run start
```

Sign in with the account from `.env`. Port 3100 is used so Kairos Tester can run
alongside an application under test on the common port 3000.

## 7. First use: import the KFastTrack checklist

1. **Applications → + New application** → `KFastTrack`.
2. **Setup → Environments**: add `Demo` and `Cloud2`. The Setup page shows a
   checklist of what is still missing before the AI can run tests.
3. **Test cases → Import XLSX / CSV**:
   * Destination: *A new historical cycle* (for example "Checklist v7 history", build
     left blank if unknown).
   * File: `KFastTrack QA Checklist-7.xlsx`, sheet **Test cases**. Columns map
     automatically; check them.
   * Preview: section headings are kept but not imported as cases; dates, outcomes,
     errors, warnings and existing IDs are listed. Nothing is saved yet.
   * Optional: preview the **How to use** sheet and save it as *unreviewed*
     application context.
   * **Confirm import**. Everything is saved in one transaction.
4. **Results** shows counts computed from the imported records. The cached Summary
   sheet is ignored.
5. **▶ Run tests** for the next build: the AI runs what it can, and anything it
   can't settle lands in **Needs you**. To record results by hand instead, use
   **Results → All cycles → + New cycle**. Every case starts as *Not run*;
   historical passes are not carried over.

Expected checkpoint for Checklist‑7 (verified by the parser test against the
real file): 123 cases, 18 sections, 73 Pass, 6 Fail, 4 Blocked, 40 Not run. If
your copy differs, the preview shows the actual numbers.

A CSV template is available from **Test cases → Download CSV template**.

## 8. AI (Ollama Cloud)

In `.env`:

```
OLLAMA_API_KEY="..."                      # server-side only
OLLAMA_CHAT_URL="https://ollama.com/api/chat"
OLLAMA_MODEL="deepseek-v4-pro:cloud"
```

Restart the app, then go to **Settings & integrations → Test connection**.

To run tests with AI, teach it each environment under **Setup → AI setup per
environment** (address, sign-in, roles, what it must never delete), then start the
runner in a second terminal and leave it open:

```powershell
npm run runner
```

The **AI runner** indicator at the bottom of the sidebar shows whether it is running.

While a run is going:

* **Watch and step in.** The run page puts the AI's **steps** (each action, its
  reasoning and whether it worked) beside a **live view** of the application, streamed
  from the runner's browser. While it works you can:
  * **Pause** and **Resume** the AI,
  * **Tell the AI something** ("use the Acme customer"); it reads it before its next action,
  * **Take control** of the browser and click/type yourself, then give it back,
  * **Stop this case**, which hands it to you in Needs you with everything done so far.

  Interrupts reach the AI within a second or two, even while it is waiting for the
  model. Set `RUNNER_HEADED=true` to also get a real browser window.
* **Nothing is skipped.** When the AI needs a person (a question, a failure to
  confirm, a case it can't do, a case it got stuck on) it waits briefly
  (`RUNNER_ASK_WAIT_MS`, default 15 s), then parks that case, adds it to **Needs you**
  and moves on to the next case it can do. A case whose prerequisite hasn't passed yet
  waits and starts by itself when the prerequisite passes.
* **The AI revisits.** Once you've done your part (fixed the bug, answered, done the
  manual step), choose *Done, let the AI check it* / *Fixed, re-test it*. The case goes
  back in the queue with your note, and the AI checks it again and confirms the result.
  A confirmed failure stays in the history; the re-check is the next attempt.
* **Notifications.** The Needs you count shows in the sidebar and the tab title. Choose
  *Turn on notifications* in the sidebar for a desktop notification whenever something
  new needs you. That
check calls the real provider and reports the model name, latency and whether it
returned valid JSON. Each AI action first shows *exactly* what will be sent
(selected text only, never attachments or credentials). The output is validated
server-side and stored as a proposal for you to edit, accept or reject. Without a
key, AI buttons are disabled and everything else works.

## 9. Tests

```powershell
npm run typecheck
npm test                 # unit tests (no database needed)

# Optional: also check the parser against the real workbook
$env:KT_SOURCE_WORKBOOK = "C:\Users\<you>\Downloads\KFastTrack QA Checklist-7.xlsx"
npm test
Remove-Item Env:KT_SOURCE_WORKBOOK

npm run test:db          # integration tests, against TEST_DATABASE_URL only
```

`test:db` refuses to run unless `TEST_DATABASE_URL` is a different database whose
name contains `test`. It applies migrations there and truncates its tables between
tests. It never touches `DATABASE_URL`.

### Smoke check of the running app

```powershell
npm run dev   # in another terminal
$env:KT_SMOKE_PASSWORD = "<tester password>"
$env:KT_SMOKE_WORKBOOK = "C:\Users\<you>\Downloads\KFastTrack QA Checklist-7.xlsx"   # optional
npm run smoke
```

This creates an application named `Smoke test <timestamp>` in the working database
and walks login → import → execute + evidence → retest → report → CSV → logout. It
only talks to Kairos Tester.

## 10. Backup and restore

A consistent backup is **the database plus the evidence folder, taken together**.
Evidence rows in the database point at files in `EVIDENCE_DIR` (default
`.\storage\evidence`).

### Backup

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
New-Item -ItemType Directory -Force "backups\$stamp" | Out-Null

# 1. Database (Docker option). Custom-format dump:
docker exec kairos-tester-postgres pg_dump -U kairos -d kairos_tester -Fc -f /tmp/kt.dump
docker cp kairos-tester-postgres:/tmp/kt.dump "backups\$stamp\kairos_tester.dump"
docker exec kairos-tester-postgres rm /tmp/kt.dump
#    (Existing server: pg_dump -h <host> -U <user> -d kairos_tester -Fc -f "backups\$stamp\kairos_tester.dump")

# 2. Evidence files (after the dump, so every row in the dump has its file)
Compress-Archive -Path "storage\evidence\*" -DestinationPath "backups\$stamp\evidence.zip"
```

Avoid recording evidence while the backup runs. A file uploaded between the two
steps is harmless: it exists on disk but not in the dump.

### Restore (into an empty database)

```powershell
$stamp = "<backup folder name>"
# 1. Stop the app. 2. Restore evidence files
Expand-Archive -Path "backups\$stamp\evidence.zip" -DestinationPath "storage\evidence" -Force
# 3. Restore the database (Docker option)
docker cp "backups\$stamp\kairos_tester.dump" kairos-tester-postgres:/tmp/kt.dump
docker exec kairos-tester-postgres pg_restore -U kairos -d kairos_tester --clean --if-exists --no-owner /tmp/kt.dump
docker exec kairos-tester-postgres rm /tmp/kt.dump
npm run db:status
```

`--clean` replaces the existing tables in `kairos_tester`, so only run it when you
intend to overwrite that database. Restore into a new database if unsure. If an
evidence link says *"Evidence file is missing from storage"*, the evidence folder
is older than the database dump.

The Docker volume can also be kept as is. `docker compose down` keeps it, while
`docker compose down -v` **deletes it**.

## 11. Security notes

* One local tester account; password hashed with scrypt; server-side sessions
  (hashed tokens in PostgreSQL); `HttpOnly`, `SameSite=Lax` cookie (`Secure` when
  `COOKIE_SECURE=true`). Set `COOKIE_SECURE=true` whenever serving over HTTPS.
* Every API route and evidence download verifies the session server-side. State-
  changing requests from other origins are rejected.
* Evidence is stored outside `public/` under generated UUID names, type-checked by
  content (not by the browser's MIME type), size-limited, served with `nosniff`
  and a sandboxing CSP, and protected against path traversal.
* The Ollama key is read server-side only, never sent to the browser, and never
  logged.
* No public report links or customer accounts in this version.

## 12. Project layout

```
prisma/                 schema.prisma, migrations/
src/app/                Next.js App Router pages and API routes (src/app/api)
src/server/             server-only code: db, auth, services, AI client, storage
src/lib/                shared pure logic: parsing, dates, metrics, rules, AI schemas
src/components/         UI components
tests/unit/             unit tests (no DB)
tests/db/               integration tests (disposable test DB)
scripts/                hash-password, smoke check
runner/                 local AI runner (npm run runner): claims queued cases, drives the browser
docs/redesign.md        architecture review and the low-friction redesign plan
docs/design.md          design system: tokens, status, components, what the UI avoids
docs/runner-interface.md  earlier design for an HTTP runner API (superseded by runner/)
docker-compose.yml      optional local PostgreSQL
```

## 13. Metric definitions

* **Coverage** = (Pass + Fail) ÷ applicable cases, where applicable means all
  cases except N/A.
* **Pass rate** = Pass ÷ (Pass + Fail).
* N/A is excluded from both. Not run and Blocked are shown separately.
* When a denominator is zero the UI shows "No completed tests" instead of a
  percentage.
* Partial-coverage flags are shown next to results. Imported Pass results whose
  notes say parts were not tested are kept as Pass and flagged *Incomplete coverage
  requiring review*.
* Customer acceptance is recorded separately and currently shows **Not recorded**.
  A pass rate is never presented as release readiness.
