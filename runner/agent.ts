// The AI loop for one test case: observe the page, ask the model for the next
// action, perform it, repeat. Checks are executed deterministically in the
// browser; the verdict policy in src/lib/agent-protocol.ts decides what needs a person.
import type { Browser } from "playwright-core";
import type { Db } from "@/server/db";
import { ollamaChat, extractJson, aiConfig, AiError } from "@/server/ai/ollama";
import { agentReplySchema, type AgentAction, type CheckRecord, type StepRecord } from "@/lib/agent-protocol";
import { parseProfile } from "@/lib/agent-profile";
import { addEvidence } from "@/server/services/evidence-service";
import { askAndWait, finishAgentAttempt, failItem, openAgentAttempt, parkItem, previousAnswers, progress, publishFrame, waitForPrerequisites, type ClaimedItem } from "@/server/services/run-service";
import { ACTIONS_PREFIX, pickRecipe } from "@/lib/recipes";
import { activateTakeover, clearControl, controlState, endTakeover, finishStep, interruptPending, markPaused, recordStep, takeCommands, takePendingInputs, takeoverState } from "@/server/services/live-control";
import { Session } from "./browser";

const MAX_TURNS = Number(process.env.RUNNER_MAX_ACTIONS || 30);
const MAX_SHOTS = 8;

function describe(a: AgentAction): string {
  switch (a.type) {
    case "sign_in": return "Signing in";
    case "read_sign_in_code": return "Reading the sign-in code";
    case "act_as": return `Switching to role: ${a.role}`;
    case "goto": return `Opening ${a.path}`;
    case "click": return `Clicking ${a.name}`;
    case "click_text": return `Clicking "${a.text}"`;
    case "fill": return `Typing into ${a.name}`;
    case "select": return `Choosing ${a.option}`;
    case "press": return `Pressing ${a.key}`;
    case "upload": return `Uploading ${a.file}`;
    case "wait": return "Waiting";
    case "check": return `Checking: ${a.description}`;
    case "screenshot": return `Screenshot: ${a.caption}`;
    case "step_done": return `Step ${a.stepIndex + 1} done (${a.result.toLowerCase()})`;
    case "ask_human": return "Asking you a question";
    case "finish": return `Finished: ${a.verdict.toLowerCase()}`;
  }
}

function systemPrompt(baseUrl: string, readOnly = false) {
  return `You are a careful QA tester executing one written test case in a real web browser.
Reply with ONE JSON object only: {"thought": "<one short sentence>", "action": {...}}.

Actions:
- {"type":"act_as","role":"<role from the case>"}  signs in if needed and switches to that role. Do this first.
- {"type":"sign_in"}  sign in as the tester's own account.
- {"type":"read_sign_in_code","email":"<optional>"}  get the newest one-time sign-in code the app sent (use this instead of asking a person for codes).
- {"type":"goto","path":"/some/path"}
- {"type":"click","role":"button|link|tab|checkbox|menuitem|...","name":"<accessible name from the snapshot>","nth":0}
- {"type":"click_text","text":"<short visible label>","nth":0}  click a tile, card or row that is NOT a button or link in the snapshot. Use a SHORT label (a heading), never a whole sentence.
- {"type":"fill","role":"textbox","name":"<label>","value":"<text>"}
- {"type":"select","name":"<combobox label>","option":"<visible option text>"}
- {"type":"press","key":"Enter|Escape|ArrowRight|..."}
- {"type":"upload","file":"<approved test file name>","name":"<optional file field label>"}  attach a test file (use this instead of clicking a file picker).
- {"type":"wait","seconds":2}
- {"type":"check","kind":"text_visible|text_absent|url_contains|element_visible|element_absent|element_disabled|element_enabled","text":"...","role":"...","name":"...","description":"<what this proves>"}
- {"type":"screenshot","caption":"<what it shows>"}
- {"type":"step_done","stepIndex":<0-based>,"result":"PASS|FAIL|BLOCKED","note":"<what you saw>"}
- {"type":"ask_human","question":"<only for things a person must do, e.g. read a real inbox>"}
- {"type":"finish","verdict":"PASS|FAIL|BLOCKED","summary":"<what happened vs expected>","confidence":0.0-1.0}

Rules:
- Use roles and names exactly as they appear in the ARIA snapshot. The snapshot already covers the WHOLE page: never scroll or press End/PageDown to look for things.
- If a click does not change anything twice, try a different route (a link with another name, or goto an address you have seen) instead of clicking again.
- Do only what the steps ask. Do not create, change or delete anything the case does not require.
- Stay on ${baseUrl}. Never try other sites.
- After each numbered step, send step_done.
- Before finish, prove every point of the expected result with check actions (they are executed for real and are what counts), and take at least one screenshot of the evidence.
- PASS only if every expected point was checked and held. FAIL if the application behaved differently from the expected result. BLOCKED if you could not carry out a step (missing data or setup, error page, unknown role).
- If something does not work after 2 tries, stop and finish with BLOCKED and explain.
- Roles mapped to the signed-in account (e.g. K admin, New K admin, Any) need no new sign-in: act_as once and carry on. Only sign out or sign in again if the case itself is about signing in.
- If a precondition cannot be met in this environment (e.g. data or a second customer that does not exist), finish BLOCKED right away and say exactly what is missing.
- You have a limited number of actions. Once you have checked the expected result, finish; do not keep exploring.
- Navigate by clicking links, tabs and buttons you see in the snapshot. Only use goto for an address you have already seen in this app. A "Not found" page after a goto you guessed is YOUR mistake, not an application failure: go back and navigate by clicking.
- If a case deletes, archives or removes something (or says "use a scratch …"), first create a new scratch item (e.g. Admin → Create a demo project, named "QA scratch …") and act only on that.
${readOnly ? `- READ-ONLY ENVIRONMENT: this is a shared system and the runner blocks every request that would change data. Look, open, filter and read only. Never create, save, assign, approve, reject, cancel, convert, delete or edit anything. If a step needs a change, finish BLOCKED and say so. If the runner reports it blocked a change request, the error on the page is NOT an application failure.\n` : ""}- If a click is reported hidden or times out, the control is probably inside a collapsed menu or another panel: open the menu button first, or use goto for an address you have already seen. Never repeat the same click.
- A text check matches the text of ONE element. Do not check a whole card or row as one long sentence when its words sit in separate elements: check one short heading or label per check. If a check fails only because of how you phrased it, rephrase it once, then move on.
- When a step says "it" or "the …", it means the specific item named in the preconditions. Never act on a different item instead, especially when removing, archiving or deleting. If that item does not exist, finish BLOCKED and say so.`;
}

export async function runItem(db: Db, browser: Browser, item: ClaimedItem, log: (s: string) => void) {
  const profile = parseProfile(item.run.environment.agentProfile);
  if (!profile) return failItem(db, item, null, "This environment is not set up for the AI runner.");
  // A prerequisite hasn't passed yet: wait for it (the case starts by itself later), don't skip.
  if (await waitForPrerequisites(db, item)) {
    log(`${item.cycleCase.testCase.externalId}: waiting for a prerequisite; moving on.`);
    return;
  }

  const agentLabel = `Kairos AI (${aiConfig().model})`;
  const attempt = await openAgentAttempt(db, item, agentLabel);
  const v = item.cycleCase.caseVersion;
  const ext = item.cycleCase.testCase.externalId;
  const steps = ((v.steps as { text: string; required: boolean }[] | null) ?? []).map((s, i) => `${i}. ${s.text}`);
  const checks: CheckRecord[] = [];
  const stepRecords: StepRecord[] = [];
  const history: string[] = [];
  let shots = 0;
  let invalid = 0;
  let repeats = 0;
  const recentSigs: string[] = [];
  let partialNote: string | null = profile.signIn.method === "email_code_outbox" && /code (from|in) the email/i.test(v.stepsText ?? "") ? "Sign-in code delivery by email was not tested: the code was read from the local code file." : null;

  const answers = await previousAnswers(db, item.id);
  const answersText = answers.map((r) => `Q: ${r.question}\nA: ${r.answer}`).join("\n");
  const session = new Session(browser, profile, [v.title, v.preconditions, v.stepsText, v.expectedResult].filter(Boolean).join("\n"));
  // Live view: keep only the newest frame and write it at most every 400 ms.
  let frame: Buffer | null = null;
  session.onFrame = (jpeg) => {
    frame = jpeg;
  };
  const frames = setInterval(() => {
    if (!frame) return;
    const f = frame;
    frame = null;
    publishFrame(db, item.id, f).catch(() => {});
  }, 400);
  try {
    await session.open();
  } catch (e) {
    clearInterval(frames);
    await session.close();
    throw e;
  }
  const uploadable = session.uploadableFiles();

  const shoot = async (caption: string) => {
    if (shots >= MAX_SHOTS) return;
    const bytes = await session.screenshot();
    const ev = await addEvidence(db, attempt.id, { name: `${ext}-${shots + 1}.png`, bytes }, caption, agentLabel);
    shots++;
    await db.runItem.update({ where: { id: item.id }, data: { lastShotId: ev.id } });
  };

  /** Stop without a verdict, but keep everything the AI checked so a person can decide quickly. */
  const finishStuck = async (why: string) => {
    await shoot("Where the AI stopped").catch(() => {});
    const done = checks.length ? ` Checks it ran: ${checks.map((c) => `${c.passed ? "✓" : "✕"} ${c.description}`).join("; ")}.` : "";
    await finishAgentAttempt(db, item, attempt.id, {
      verdict: "BLOCKED",
      summary: `The AI could not finish: ${why}${done}`,
      confidence: 0,
      checks,
      steps: stepRecords,
      screenshots: shots,
      partialNote,
      humanTouched,
    });
  };

  let humanTouched = false;
  const MAX_TAKEOVER_MS = 10 * 60_000;

  /** While a person drives from the live view the AI waits; their inputs are applied here. */
  const letPersonDrive = async () => {
    humanTouched = true;
    await activateTakeover(db, item.id);
    await db.runEvent.create({ data: { runId: item.runId, runItemId: item.id, message: `${ext}: a person took over the browser.` } });
    await recordStep(db, item.id, { kind: "SYSTEM", label: "The AI paused and handed over the browser" });
    const until = Date.now() + MAX_TAKEOVER_MS;
    while (Date.now() < until) {
      if ((await takeoverState(db, item.id)) !== "ACTIVE") break;
      for (const input of await takePendingInputs(db, item.id)) {
        await session.applyInput(input).catch(() => {});
        await session.page.waitForTimeout(150);
      }
      await session.pushFrame();
      await new Promise((r) => setTimeout(r, 250));
    }
    await endTakeover(db, item.id);
    await session.settle();
    history.push("A person drove the browser for a while and gave it back. The page may be different now; look at the snapshot before acting.");
    partialNote = partialNote ?? "A person used the browser during this case, so the AI result needs a person's confirmation.";
    await progress(db, item.id, "The AI has the browser back", item.runId);
    await recordStep(db, item.id, { kind: "SYSTEM", label: "The AI has the browser back" });
  };

  // ---- interrupts from the person watching (pause, message, stop, take control)
  const guidance: string[] = [];
  let stopBy: { by: string; text: string | null } | null = null;
  const MAX_PAUSE_MS = 30 * 60_000;

  /**
   * Everything a person can do to a running case is handled here, between actions:
   * messages join the AI's instructions, Stop ends the case, Take control hands the
   * browser over, and Pause waits until Resume.
   */
  const checkpoint = async (): Promise<"go" | "stop"> => {
    let pausedAt: number | null = null;
    for (;;) {
      for (const c of await takeCommands(db, item.id)) {
        if (c.kind === "STOP") stopBy = { by: c.by, text: c.text };
        else if (c.text) {
          guidance.push(`${c.by}: ${c.text}`);
          history.push(`The person watching (${c.by}) told you: "${c.text}"`);
          log(`${ext}: message from ${c.by}: ${c.text}`);
        }
      }
      if (stopBy) return "stop";
      const st = await controlState(db, item.id);
      if (st.takeover === "REQUESTED") {
        await letPersonDrive();
        continue;
      }
      if (st.pause === "REQUESTED") {
        await markPaused(db, item.id);
        await recordStep(db, item.id, { kind: "SYSTEM", label: "The AI is paused" });
        await session.pushFrame();
        log(`${ext}: paused by a person.`);
        pausedAt = Date.now();
        continue;
      }
      if (st.pause === "PAUSED") {
        pausedAt ??= Date.now();
        if (Date.now() - pausedAt > MAX_PAUSE_MS) {
          stopBy = { by: "the runner", text: "it stayed paused for more than 30 minutes" };
          return "stop";
        }
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }
      if (pausedAt !== null) {
        history.push("A person paused you for a while and then let you carry on. Look at the page before acting.");
        await progress(db, item.id, "Carrying on", item.runId);
      }
      return "go";
    }
  };

  /** A person stopped the case: hand it to them in Needs you with everything done so far. */
  const finishStopped = async () => {
    const who = stopBy ?? { by: "a person", text: null };
    await shoot("Where the case was stopped").catch(() => {});
    const done = checks.length ? ` Checks it ran: ${checks.map((c) => `${c.passed ? "✓" : "✕"} ${c.description}`).join("; ")}.` : "";
    await finishAgentAttempt(db, item, attempt.id, {
      verdict: "BLOCKED",
      summary: `Stopped by ${who.by}${who.text ? `: ${who.text}` : ""}.${done}`,
      confidence: 0,
      checks,
      steps: stepRecords,
      screenshots: shots,
      partialNote,
      humanTouched: true,
      why: `Stopped by ${who.by}${who.text ? `: ${who.text}` : ""}. Check what the AI did and decide.`,
    });
    await recordStep(db, item.id, { kind: "SYSTEM", label: "Handed to a person", result: "It is in Needs you with what the AI did so far." });
    log(`${ext}: stopped by ${who.by}.`);
  };

  const INTERRUPTED: unique symbol = Symbol("interrupted");
  /** Wait for the model, but give way at once if a person wants something; the late reply is dropped. */
  const untilInterrupted = async <T,>(p: Promise<T>): Promise<T | typeof INTERRUPTED> => {
    let settled = false;
    p.catch(() => {}); // a dropped call may still fail later
    const watch = (async (): Promise<typeof INTERRUPTED> => {
      while (!settled) {
        await new Promise((r) => setTimeout(r, 700));
        if (!settled && (await interruptPending(db, item.id).catch(() => false))) return INTERRUPTED;
      }
      return INTERRUPTED;
    })();
    try {
      return await Promise.race([p, watch]);
    } finally {
      settled = true;
    }
  };

  const failedResult = (r: string) => /^(ERROR|REFUSED|Refused|Unknown role|Not a browser action|CHECK FAILED)/.test(r);

  /** Run a reviewed recipe step (same browser guards as AI actions). Returns the outcome text. */
  const doStep = async (a: AgentAction): Promise<string> => {
    if (a.type === "act_as") return session.actAs(a.role);
    if (a.type === "screenshot") {
      await shoot(a.caption);
      return "Screenshot saved.";
    }
    return session.perform(a);
  };

  try {
    // A reviewed recipe goes first. SETUP cases finish on it when its checks pass;
    // for TEST cases it only prepares the state, and the AI still verifies the case itself.
    const recipes = await db.recipe.findMany({ where: { applicationId: item.cycleCase.testCase.applicationId, status: "ACTIVE" } });
    const recipe = pickRecipe(recipes, { externalId: ext, title: v.title, section: v.section, purpose: item.purpose }, item.run.environmentId);
    if (recipe) {
      await db.runEvent.create({ data: { runId: item.runId, runItemId: item.id, message: `${ext}: trying recipe "${recipe.name}".` } });
      let failedAt: string | null = null;
      try {
        if (!session.signedIn && recipe.steps[0]?.type !== "act_as") await session.actAs(v.role ?? "Any");
        for (const [i, step] of recipe.steps.entries()) {
          if ((await checkpoint()) === "stop") return finishStopped();
          await progress(db, item.id, `Recipe "${recipe.name}": ${describe(step)}`, item.runId);
          const sid = await recordStep(db, item.id, { kind: "RECIPE", label: `Recipe "${recipe.name}": ${describe(step)}` });
          const r = await doStep(step);
          await finishStep(db, sid, r, !failedResult(r));
          history.push(`recipe ${i + 1}/${recipe.steps.length} ${JSON.stringify(step)} -> ${r}`);
          await session.pushFrame();
          if (/^(REFUSED|Refused|Unknown role|Not a browser action)/.test(r)) {
            failedAt = `step ${i + 1} (${describe(step)}): ${r}`;
            break;
          }
        }
      } catch (e) {
        failedAt = String((e as Error).message).split("\n")[0].slice(0, 200);
      }
      const recipeChecks: CheckRecord[] = [];
      if (!failedAt) for (const c of recipe.checks) if (c.type === "check") recipeChecks.push(await session.check(c));
      const bad = recipeChecks.find((c) => !c.passed);
      if (bad) failedAt = `success check failed: ${bad.description} (${bad.detail})`;
      if (!failedAt && item.purpose === "SETUP") {
        await shoot(`Done by recipe: ${recipe.name}`);
        await finishAgentAttempt(db, item, attempt.id, {
          verdict: "PASS",
          summary: `Done by reviewed recipe "${recipe.name}"; no AI improvisation.`,
          confidence: 1,
          checks: recipeChecks,
          steps: stepRecords,
          screenshots: shots,
          partialNote,
        });
        return;
      }
      if (failedAt) {
        history.push(`Recipe "${recipe.name}" did not finish (${failedAt}). Carry on yourself from the current page.`);
        await db.runEvent.create({ data: { runId: item.runId, runItemId: item.id, message: `${ext}: recipe "${recipe.name}" failed (${failedAt}); AI takes over.` } });
      } else {
        history.push(`Recipe "${recipe.name}" prepared the application. Still verify this case yourself with checks.`);
      }
    }

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      if ((await checkpoint()) === "stop") return finishStopped();
      const snapshot = await session.snapshot();
      const left = MAX_TURNS - turn;
      const checksSoFar = checks.map((c) => `${c.passed ? "PASSED" : "FAILED"}: ${c.description}`).join("\n");
      const stepsSoFar = stepRecords.map((s) => `step ${s.stepIndex} ${s.result}`).join(", ");
      const warnings = [
        repeats >= 3 ? `WARNING: you have done the same action ${repeats} times recently without progress. Stop: decide now and finish (BLOCKED if you are stuck).` : "",
        left <= 6 ? `WARNING: only ${left} actions left. Finish now with what you have checked.` : "",
      ].filter(Boolean).join("\n");
      const setupNote =
        item.purpose === "SETUP"
          ? `SETUP MODE: this case passed before. Your job is only to put the application into the state this case leaves it in (create/upload/approve what the steps do), so later cases can run. Do the steps, make ONE quick check that the main result happened, take one screenshot, then finish. Do not verify every detail.\n\n`
          : "";
      const user = `${setupNote}Test case ${ext}: ${v.title}
Sign in as (role): ${v.role ?? "not stated"}
Preconditions: ${v.preconditions ?? "none"}
Steps (0-based):
${steps.join("\n") || v.stepsText}
Expected result: ${v.expectedResult ?? "not stated"}
${profile.notes ? `\nNotes about this application:\n${profile.notes}\n` : ""}
Roles you can act as: ${Object.keys(profile.roleAccounts).join(", ") || "(only the signed-in account)"}
Protected (never delete, archive or remove; the runner refuses): ${profile.protectedNames.join(", ") || "none"}
Approved test files for upload: ${uploadable.join(", ") || "none"}
${answersText ? `\nAnswers the person already gave for this case:\n${answersText}\n` : ""}${guidance.length ? `\nInstructions from the person watching this run (follow them; the safety rules and protected names still apply):\n${guidance.join("\n")}\n` : ""}
Action ${turn + 1} of ${MAX_TURNS}.
Checks so far: ${checksSoFar ? "\n" + checksSoFar : "none"}
Steps confirmed: ${stepsSoFar || "none"}
${warnings ? "\n" + warnings + "\n" : ""}
Recent actions:
${history.slice(-14).join("\n") || "(nothing yet)"}

Current page: ${session.signedIn ? session.path() : "(not opened yet)"}
ARIA snapshot:
${session.signedIn ? snapshot : "(open the app with act_as or sign_in first)"}

Next action?`;
      let reply;
      try {
        const res = await untilInterrupted(
          ollamaChat(
            [
              { role: "system", content: systemPrompt(profile.baseUrl, profile.readOnly) },
              { role: "user", content: user },
            ],
            { json: true, timeoutMs: 90_000 },
          ),
        );
        if (res === INTERRUPTED) {
          // A person stepped in while the AI was thinking: drop this reply and handle them first.
          turn--;
          continue;
        }
        reply = agentReplySchema.parse(extractJson(res.content));
        invalid = 0;
      } catch (e) {
        if (e instanceof AiError && ["not_configured", "auth", "model_not_found"].includes(e.code)) throw e;
        invalid++;
        history.push(`#${turn} (your reply was not a valid action: ${String((e as Error).message).slice(0, 150)})`);
        if (invalid >= 3) throw new Error("The AI gave 3 invalid replies in a row.");
        continue;
      }
      const a = reply.action;
      // The page matters: clicking "Home" from five different pages is navigation, not a loop.
      const sig = JSON.stringify({ ...a, ...(a.type === "check" ? { description: "" } : {}), at: session.signedIn ? session.path() : "" });
      // Loops are often not back-to-back (e.g. goto A, check, goto A, check…): count repeats among recent actions.
      recentSigs.push(sig);
      if (recentSigs.length > 10) recentSigs.shift();
      repeats = recentSigs.filter((s) => s === sig).length;
      if (repeats >= 4 && a.type !== "step_done" && a.type !== "screenshot") {
        await finishStuck(`It kept repeating "${describe(a)}" without making progress.`);
        return;
      }
      await progress(db, item.id, describe(a), item.runId);
      log(`${ext} #${turn}: ${describe(a)}`);
      const stepId = await recordStep(db, item.id, { kind: "AI", label: describe(a), thought: reply.thought || null });

      let result: string;
      try {
        if (a.type === "sign_in") result = await session.signIn();
        else if (a.type === "act_as") result = await session.actAs(a.role);
        else if (a.type === "read_sign_in_code") {
          result = await session.readSignInCode(a.email);
          if (/ is \d+/.test(result)) partialNote = "Sign-in code delivery by email was not tested: the code was read from the app's local code file.";
        }
        else if (a.type === "check") {
          const c = await session.check(a);
          checks.push(c);
          result = `${c.passed ? "CHECK PASSED" : "CHECK FAILED"}: ${c.detail}`;
          if (!c.passed) await shoot(`Failed check: ${a.description}`);
        } else if (a.type === "screenshot") {
          await shoot(a.caption);
          result = "Screenshot saved.";
        } else if (a.type === "step_done") {
          stepRecords.push({ stepIndex: a.stepIndex, result: a.result, note: a.note });
          result = "Noted.";
        } else if (a.type === "ask_human") {
          const r = await askAndWait(db, item, a.question);
          if (r.status === "timeout") {
            // Nobody answered yet: notify (it is in Needs you), park, and move on to work the
            // AI can do. Answering puts this case back in the queue and the AI revisits it.
            await shoot("Waiting for an answer").catch(() => {});
            await finishStep(db, stepId, "No answer yet. The case waits in Needs you; the AI moves on and comes back once you answer.", null);
            await parkItem(db, item, attempt.id, a.question);
            log(`${ext}: asked a person "${a.question}"; moving on until they answer.`);
            return;
          }
          result = r.status === "answered" ? `The person answered: ${r.answer}` : "The person skipped this. Finish with BLOCKED if you cannot continue.";
        } else if (a.type === "finish") {
          if (shots === 0) await shoot("Final state");
          await finishStep(db, stepId, `Verdict ${a.verdict}: ${a.summary}`, a.verdict === "PASS" ? true : a.verdict === "FAIL" ? false : null);
          await finishAgentAttempt(db, item, attempt.id, {
            verdict: a.verdict,
            summary: a.summary,
            confidence: a.confidence,
            checks,
            steps: stepRecords,
            screenshots: shots,
            partialNote,
            humanTouched,
          });
          return;
        } else result = await session.perform(a);
      } catch (e) {
        if (a.type === "finish") throw e; // could not record the result: stop this case
        result = `ERROR: ${String((e as Error).message).split("\n")[0].slice(0, 200)}`;
      }
      const dialogs = session.takeDialogs();
      if (dialogs.length) result += ` NOTE: a browser pop-up appeared and was closed. It said: ${dialogs.map((d) => `"${d}"`).join("; ")}. A text check for its wording will now find it.`;
      const blocked = session.takeBlocked();
      if (blocked.length) result += ` NOTE: the read-only guard blocked a change request (${blocked.join(", ")}). Any error on the page is caused by that, not by the application. If this step needs the change, finish BLOCKED.`;
      await session.pushFrame();
      await finishStep(db, stepId, result, a.type === "check" ? (checks[checks.length - 1]?.passed ?? false) : !failedResult(result));
      history.push(`#${turn} ${JSON.stringify(a)} -> ${result}`);
    }
    await finishStuck(`it used all ${MAX_TURNS} actions.`);
  } catch (e) {
    await shoot("State when the run stopped").catch(() => {});
    await failItem(db, item, attempt.id, String((e as Error).message).split("\n")[0].slice(0, 300));
  } finally {
    // Keep what the AI did so a person can ask for a recipe from it later.
    if (history.length) {
      await db.runEvent
        .create({ data: { runId: item.runId, runItemId: item.id, message: `${ACTIONS_PREFIX}${ext}\n${history.slice(-40).join("\n")}`.slice(0, 8000) } })
        .catch(() => {});
    }
    clearInterval(frames);
    await clearControl(db, item.id).catch(() => {});
    await session.close();
  }
}
