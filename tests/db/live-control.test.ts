// A person taking over the runner's browser: control rules and input validation.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { testDb, resetDb, importRows, sampleRows } from "./helpers";
import { createCycle } from "@/server/services/cycle-service";
import { setControl, queueInput, activateTakeover, takePendingInputs, takeoverState, endTakeover, liveInputSchema, interruptPending, takeCommands, markPaused, controlState, clearControl, recordStep } from "@/server/services/live-control";

const db = testDb();
afterAll(() => db.$disconnect());

let appId: string;
let runId: string;
let itemId: string;
beforeEach(async () => {
  await resetDb(db);
  appId = (await db.application.create({ data: { name: "KFastTrack" } })).id;
  await importRows(db, appId, sampleRows(), { kind: "new", name: "Historical" });
  const cycle = await createCycle(db, appId, { name: "Run", kind: "STANDARD", include: { mode: "all" } }, "t");
  const env = await db.environment.create({ data: { applicationId: appId, name: "Demo" } });
  const cc = await db.cycleCase.findFirstOrThrow({ where: { cycleId: cycle.id, testCase: { externalId: "SI-01" } } });
  runId = (await db.testRun.create({ data: { cycleId: cycle.id, environmentId: env.id, model: "m", startedBy: "t" } })).id;
  itemId = (await db.runItem.create({ data: { runId, cycleCaseId: cc.id, sortOrder: 0, plan: "AUTOMATABLE", status: "RUNNING" } })).id;
});

describe("live takeover", () => {
  it("input is refused until the runner has handed control over", async () => {
    const click = { itemId, events: [{ kind: "click" as const, x: 10, y: 10 }] };
    await expect(queueInput(db, appId, runId, click)).rejects.toThrow(/not in control/);
    await setControl(db, appId, runId, { itemId, action: "take" }, "dyah");
    expect(await takeoverState(db, itemId)).toBe("REQUESTED");
    await expect(queueInput(db, appId, runId, click)).rejects.toThrow(/not in control/); // AI has not paused yet
    await activateTakeover(db, itemId);
    expect(await queueInput(db, appId, runId, click)).toEqual({ queued: 1 });
  });

  it("only a running case can be taken over", async () => {
    await db.runItem.update({ where: { id: itemId }, data: { status: "QUEUED" } });
    await expect(setControl(db, appId, runId, { itemId, action: "take" }, "dyah")).rejects.toThrow(/not running/);
  });

  it("the runner receives inputs once, in order, and giving back clears them", async () => {
    await setControl(db, appId, runId, { itemId, action: "take" }, "dyah");
    await activateTakeover(db, itemId);
    await queueInput(db, appId, runId, { itemId, events: [{ kind: "click", x: 1, y: 2 }, { kind: "type", text: "hi" }] });
    const got = await takePendingInputs(db, itemId);
    expect(got.map((e) => e.kind)).toEqual(["click", "type"]);
    expect(await takePendingInputs(db, itemId)).toEqual([]);
    await queueInput(db, appId, runId, { itemId, events: [{ kind: "key", key: "Enter" }] });
    await setControl(db, appId, runId, { itemId, action: "give_back" }, "dyah");
    expect(await takeoverState(db, itemId)).toBe("NONE");
    expect(await takePendingInputs(db, itemId)).toEqual([]);
  });

  it("the runner ending takeover resets state and pending input", async () => {
    await setControl(db, appId, runId, { itemId, action: "take" }, "dyah");
    await activateTakeover(db, itemId);
    await endTakeover(db, itemId);
    expect(await takeoverState(db, itemId)).toBe("NONE");
  });

  it("rejects unsafe or malformed input", () => {
    expect(liveInputSchema.safeParse({ kind: "click", x: 5000, y: 1 }).success).toBe(false);
    expect(liveInputSchema.safeParse({ kind: "key", key: "F12" }).success).toBe(false);
    expect(liveInputSchema.safeParse({ kind: "key", key: "Control+a" }).success).toBe(false);
    expect(liveInputSchema.safeParse({ kind: "type", text: "x".repeat(300) }).success).toBe(false);
    expect(liveInputSchema.safeParse({ kind: "scroll", dy: 99999 }).success).toBe(false);
  });

  it("cannot reach an item of another run", async () => {
    await expect(setControl(db, appId, "not-this-run", { itemId, action: "take" }, "dyah")).rejects.toThrow(/not found/);
  });

  it("pause is requested by a person and becomes real only when the runner reaches a checkpoint", async () => {
    expect(await interruptPending(db, itemId)).toBe(false);
    await setControl(db, appId, runId, { itemId, action: "pause" }, "dyah");
    expect((await controlState(db, itemId)).pause).toBe("REQUESTED");
    expect(await interruptPending(db, itemId)).toBe(true);
    await markPaused(db, itemId);
    expect((await controlState(db, itemId)).pause).toBe("PAUSED");
    await setControl(db, appId, runId, { itemId, action: "resume" }, "dyah");
    expect((await controlState(db, itemId)).pause).toBe("NONE");
    const steps = await db.agentStep.findMany({ where: { runItemId: itemId }, orderBy: { createdAt: "asc" } });
    expect(steps.map((s) => s.label)).toEqual(["dyah paused the AI", "dyah let the AI carry on"]);
  });

  it("a message reaches the AI once and its step shows it was read", async () => {
    await expect(setControl(db, appId, runId, { itemId, action: "message", text: "  " }, "dyah")).rejects.toThrow(/Type a message/);
    await setControl(db, appId, runId, { itemId, action: "message", text: "Use the Acme customer" }, "dyah");
    expect(await interruptPending(db, itemId)).toBe(true);
    expect(await takeCommands(db, itemId)).toEqual([{ kind: "MESSAGE", text: "Use the Acme customer", by: "dyah" }]);
    expect(await takeCommands(db, itemId)).toEqual([]);
    expect(await interruptPending(db, itemId)).toBe(false);
    const step = await db.agentStep.findFirstOrThrow({ where: { runItemId: itemId } });
    expect(step).toMatchObject({ kind: "PERSON", label: "dyah: Use the Acme customer", result: "The AI read this.", ok: true });
  });

  it("stopping a case wakes a paused AI so it can hand the case over", async () => {
    await setControl(db, appId, runId, { itemId, action: "pause" }, "dyah");
    await markPaused(db, itemId);
    await setControl(db, appId, runId, { itemId, action: "stop_case", text: "Wrong data" }, "dyah");
    expect((await controlState(db, itemId)).pause).toBe("NONE");
    expect(await takeCommands(db, itemId)).toEqual([{ kind: "STOP", text: "Wrong data", by: "dyah" }]);
  });

  it("controls only apply to a case the AI is running, and are cleared when it ends", async () => {
    await recordStep(db, itemId, { kind: "AI", label: "Open /login", thought: "Start at sign-in" });
    await setControl(db, appId, runId, { itemId, action: "message", text: "hello" }, "dyah");
    await setControl(db, appId, runId, { itemId, action: "pause" }, "dyah");
    await clearControl(db, itemId);
    expect(await interruptPending(db, itemId)).toBe(false);
    await db.runItem.update({ where: { id: itemId }, data: { status: "DONE" } });
    for (const action of ["pause", "message", "stop_case"] as const) {
      await expect(setControl(db, appId, runId, { itemId, action, text: "x" }, "dyah")).rejects.toThrow(/not running/);
    }
  });
});
