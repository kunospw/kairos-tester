// Kairos Tester local AI runner. Start with:  npm run runner
// Picks queued cases from AI runs, drives the browser with the configured
// Ollama model, and records results. Runs outside the web app's request handlers.
import { createPrismaClient } from "@/server/db";
import { aiConfig } from "@/server/ai/ollama";
import { claimNext, discardUndecidedAgentAttempt, failItem, heartbeat } from "@/server/services/run-service";
import { controlState } from "@/server/services/live-control";

const REQUEUED = "Re-queued after the runner restarted.";
const BROWSER_REQUEUED = "Re-queued: the browser stopped.";
/** Abandon a case that makes no progress for this long (e.g. a hung browser). */
const CASE_TIMEOUT_MS = Number(process.env.RUNNER_CASE_TIMEOUT_MS || 12 * 60_000);
import { launch } from "./browser";
import { runItem } from "./agent";

const db = createPrismaClient();
const log = (s: string) => console.log(`[${new Date().toLocaleTimeString()}] ${s}`);

async function recoverInterrupted() {
  // Cases left "running" by a previous runner that stopped mid-case.
  const stale = await db.runItem.findMany({ where: { status: "RUNNING" }, select: { id: true } });
  for (const { id } of stale) {
    const item = await db.runItem.findUniqueOrThrow({
      where: { id },
      include: { run: { include: { environment: true, cycle: { include: { application: true } } } }, cycleCase: { include: { testCase: true, caseVersion: true } } },
    });
    await db.humanRequest.updateMany({ where: { runItemId: id, status: "OPEN", kind: "INPUT" }, data: { status: "SKIPPED", answer: "runner restarted" } });
    if (item.attemptId) await discardUndecidedAgentAttempt(db, item.attemptId);
    if ((item.statusNote ?? "").includes(REQUEUED)) {
      await failItem(db, item, null, "The runner stopped twice while this case was running.");
    } else {
      // A runner crash is not the case's fault: give it one more go.
      await db.runItem.update({ where: { id }, data: { status: "QUEUED", attemptId: null, currentStep: null, statusNote: REQUEUED } });
    }
  }
  if (stale.length) log(`Recovered ${stale.length} interrupted case(s).`);
}

async function main() {
  const cfg = aiConfig();
  if (!cfg.keyConfigured) {
    console.error("OLLAMA_API_KEY is not set in .env. The AI runner needs it.");
    process.exit(1);
  }
  log(`Kairos AI runner started. Model: ${cfg.model}. Waiting for runs… (Ctrl+C to stop)`);
  await recoverInterrupted();
  let browser = await launch();
  let stopping = false;
  process.on("SIGINT", () => {
    stopping = true;
    log("Stopping after the current case…");
  });
  const beat = setInterval(() => heartbeat(db, "idle").catch(() => {}), 5000);
  await heartbeat(db, "idle");
  while (!stopping) {
    if (!browser.isConnected()) {
      log("The browser had stopped; starting a new one.");
      browser = await launch();
    }
    const item = await claimNext(db);
    if (!item) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    log(`Running ${item.cycleCase.testCase.externalId}: ${item.cycleCase.caseVersion.title}`);
    try {
      let timer: NodeJS.Timeout | undefined;
      // Time a person spends pausing or driving the browser doesn't count against the case.
      const watchdog = new Promise<"timeout">((resolve) => {
        let deadline = Date.now() + CASE_TIMEOUT_MS;
        timer = setInterval(async () => {
          const st = await controlState(db, item.id).catch(() => null);
          if (st && (st.pause !== "NONE" || st.takeover !== "NONE")) deadline = Date.now() + CASE_TIMEOUT_MS;
          if (Date.now() > deadline) resolve("timeout");
        }, 5000);
      });
      const outcome = await Promise.race([runItem(db, browser, item, log).then(() => "done" as const), watchdog]).finally(() => clearInterval(timer));
      if (outcome === "timeout") {
        log(`${item.cycleCase.testCase.externalId}: no progress for ${Math.round(CASE_TIMEOUT_MS / 60000)} min, abandoning and restarting the browser.`);
        await browser.close().catch(() => {});
        browser = await launch();
        const fresh = await db.runItem.findUniqueOrThrow({ where: { id: item.id } });
        if (fresh.status === "RUNNING") await failItem(db, item, fresh.attemptId, "The case made no progress (the browser stopped responding).");
      }
    } catch (e) {
      if (!browser.isConnected()) {
        // The browser died (crash, killed): that is not the case's fault. Put it back and carry on.
        log(`${item.cycleCase.testCase.externalId}: the browser stopped; putting the case back in the queue.`);
        const fresh = await db.runItem.findUnique({ where: { id: item.id } });
        if ((fresh?.statusNote ?? "").includes(BROWSER_REQUEUED)) {
          await failItem(db, item, fresh?.attemptId ?? null, "The browser stopped twice while running this case.").catch(() => {});
          continue;
        }
        if (fresh?.attemptId) await discardUndecidedAgentAttempt(db, fresh.attemptId).catch(() => {});
        await db.runItem.update({ where: { id: item.id }, data: { status: "QUEUED", attemptId: null, currentStep: null, statusNote: BROWSER_REQUEUED } });
        continue;
      }
      log(`Error on ${item.cycleCase.testCase.externalId}: ${(e as Error).message}`);
      await failItem(db, item, item.attemptId, String((e as Error).message).slice(0, 300)).catch(() => {});
    }
  }
  clearInterval(beat);
  await browser.close();
  await db.$disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
