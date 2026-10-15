// A person taking over the runner's browser from the live view. The AI pauses while
// the person drives; whatever they did is flagged so the result is never auto-passed.
import { z } from "zod";
import type { Db } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";
import { badRequest, conflict, notFound } from "@/server/errors";

/** The runner's browser window size; clicks are sent in these coordinates. */
export const VIEWPORT = { width: 1366, height: 900 };
const MAX_EVENTS = 20;

const key = z.string().min(1).max(20).regex(/^(Enter|Backspace|Tab|Escape|Delete|Home|End|PageUp|PageDown|Arrow(Up|Down|Left|Right))$/, "Key not allowed.");

export const liveInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("click"), x: z.number().min(0).max(VIEWPORT.width), y: z.number().min(0).max(VIEWPORT.height), double: z.boolean().optional() }),
  z.object({ kind: z.literal("type"), text: z.string().min(1).max(200) }),
  z.object({ kind: z.literal("key"), key }),
  z.object({ kind: z.literal("scroll"), dy: z.number().min(-2000).max(2000) }),
]);
export type LiveInputEvent = z.infer<typeof liveInputSchema>;

export const controlSchema = z.object({
  itemId: z.string().min(1),
  action: z.enum(["take", "give_back", "pause", "resume", "message", "stop_case"]),
  /** For "message" (required) and "stop_case" (optional reason). */
  text: z.string().trim().max(1000).optional(),
});
export const inputBatchSchema = z.object({ itemId: z.string().min(1), events: z.array(liveInputSchema).min(1).max(MAX_EVENTS) });

async function runningItem(db: Db, applicationId: string, runId: string, itemId: string) {
  const item = await db.runItem.findFirst({
    where: { id: itemId, runId, run: { cycle: { applicationId } } },
    select: { id: true, status: true, takeover: true, pause: true, runId: true },
  });
  if (!item) throw notFound("Run item not found.");
  return item;
}

/** Write one entry in the step log beside the live view. */
export async function recordStep(db: Db, runItemId: string, step: { kind: "AI" | "RECIPE" | "PERSON" | "SYSTEM"; label: string; thought?: string | null; result?: string | null; ok?: boolean | null }) {
  const row = await db.agentStep.create({
    data: {
      runItemId,
      kind: step.kind,
      label: step.label.slice(0, 500),
      thought: step.thought ? step.thought.slice(0, 2000) : null,
      result: step.result ? step.result.slice(0, 1000) : null,
      ok: step.ok ?? null,
    },
  });
  return row.id;
}

export async function finishStep(db: Db, stepId: string, result: string, ok: boolean | null) {
  await db.agentStep.update({ where: { id: stepId }, data: { result: result.slice(0, 1000), ok } });
}

export async function setControl(db: Db, applicationId: string, runId: string, input: z.infer<typeof controlSchema>, user: string) {
  const item = await runningItem(db, applicationId, runId, input.itemId);
  const live = item.status === "RUNNING";
  const person = (label: string, result?: string) => recordStep(db, item.id, { kind: "PERSON", label, result: result ?? null });

  switch (input.action) {
    case "take": {
      if (!live) throw conflict("The AI is not running this case right now.");
      if (item.takeover === "NONE") {
        await db.runItem.update({ where: { id: item.id }, data: { takeover: "REQUESTED" } });
        await db.runEvent.create({ data: { runId, runItemId: item.id, message: `${user} asked to take over the browser.` } });
        await person(`${user} asked for control of the browser`);
      }
      return { takeover: item.takeover === "NONE" ? "REQUESTED" : item.takeover };
    }
    case "give_back": {
      // Giving the browser back also lifts a pause: the AI carries on.
      await db.runItem.update({ where: { id: item.id }, data: { takeover: "NONE", pause: "NONE" } });
      await db.liveInput.deleteMany({ where: { runItemId: item.id } });
      if (item.takeover !== "NONE") await person(`${user} gave the browser back to the AI`);
      return { takeover: "NONE" as const };
    }
    case "pause": {
      if (!live) throw conflict("The AI is not running this case right now.");
      if (item.pause === "NONE") {
        await db.runItem.update({ where: { id: item.id }, data: { pause: "REQUESTED" } });
        await person(`${user} paused the AI`);
      }
      return { pause: item.pause === "NONE" ? "REQUESTED" : item.pause };
    }
    case "resume": {
      await db.runItem.update({ where: { id: item.id }, data: { pause: "NONE" } });
      if (item.pause !== "NONE") await person(`${user} let the AI carry on`);
      return { pause: "NONE" as const };
    }
    case "message": {
      if (!live) throw conflict("The AI is not running this case right now.");
      const text = input.text?.trim();
      if (!text) throw badRequest("Type a message for the AI.");
      const stepId = await person(`${user}: ${text}`, "Sent. The AI reads it before its next action.");
      await db.agentCommand.create({ data: { runItemId: item.id, kind: "MESSAGE", text, by: user, stepId } });
      return { queued: true };
    }
    case "stop_case": {
      if (!live) throw conflict("The AI is not running this case right now.");
      const text = input.text?.trim() || null;
      const stepId = await person(`${user} stopped this case${text ? `: ${text}` : ""}`, "The AI stops at its next checkpoint and hands the case to you.");
      await db.agentCommand.create({ data: { runItemId: item.id, kind: "STOP", text, by: user, stepId } });
      // A paused AI must wake up to stop.
      if (item.pause !== "NONE") await db.runItem.update({ where: { id: item.id }, data: { pause: "NONE" } });
      return { queued: true };
    }
  }
}

/** Inputs are accepted only while the runner has actually handed control over (ACTIVE). */
export async function queueInput(db: Db, applicationId: string, runId: string, input: z.infer<typeof inputBatchSchema>) {
  const item = await runningItem(db, applicationId, runId, input.itemId);
  if (item.takeover !== "ACTIVE") throw conflict("You are not in control of the browser.");
  await db.liveInput.createMany({ data: input.events.map((e) => ({ runItemId: item.id, kind: e.kind, payload: e as unknown as Prisma.InputJsonValue })) });
  return { queued: input.events.length };
}

// ---- runner side

export async function takeoverState(db: Db, itemId: string) {
  const r = await db.runItem.findUnique({ where: { id: itemId }, select: { takeover: true } });
  return r?.takeover ?? "NONE";
}

export async function activateTakeover(db: Db, itemId: string) {
  await db.liveInput.deleteMany({ where: { runItemId: itemId } });
  await db.runItem.updateMany({ where: { id: itemId, takeover: "REQUESTED" }, data: { takeover: "ACTIVE", currentStep: "A person is driving the browser" } });
}

export async function endTakeover(db: Db, itemId: string) {
  await db.runItem.updateMany({ where: { id: itemId }, data: { takeover: "NONE" } });
  await db.liveInput.deleteMany({ where: { runItemId: itemId } });
}

/** Oldest first; deleted as they are handed over so each input runs once. */
export async function takePendingInputs(db: Db, itemId: string): Promise<LiveInputEvent[]> {
  const rows = await db.liveInput.findMany({ where: { runItemId: itemId }, orderBy: { createdAt: "asc" }, take: 50 });
  if (!rows.length) return [];
  await db.liveInput.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  return rows.flatMap((r) => {
    const p = liveInputSchema.safeParse(r.payload);
    return p.success ? [p.data] : [];
  });
}

/** Cheap check the runner makes while it waits for the model: does a person want something? */
export async function interruptPending(db: Db, itemId: string): Promise<boolean> {
  const r = await db.runItem.findUnique({
    where: { id: itemId },
    select: { takeover: true, pause: true, _count: { select: { commands: { where: { handledAt: null } } } } },
  });
  return Boolean(r && (r.takeover === "REQUESTED" || r.pause === "REQUESTED" || r.pause === "PAUSED" || r._count.commands > 0));
}

export async function controlState(db: Db, itemId: string) {
  const r = await db.runItem.findUnique({ where: { id: itemId }, select: { takeover: true, pause: true } });
  return { takeover: r?.takeover ?? "NONE", pause: r?.pause ?? "NONE" };
}

/** Hand the runner the commands people sent, oldest first, each exactly once. */
export async function takeCommands(db: Db, itemId: string) {
  const rows = await db.agentCommand.findMany({ where: { runItemId: itemId, handledAt: null }, orderBy: { createdAt: "asc" } });
  if (!rows.length) return [];
  const now = new Date();
  await db.agentCommand.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { handledAt: now } });
  for (const r of rows) {
    if (r.kind === "MESSAGE" && r.stepId) await db.agentStep.updateMany({ where: { id: r.stepId }, data: { result: "The AI read this.", ok: true } });
  }
  return rows.map((r) => ({ kind: r.kind as "MESSAGE" | "STOP", text: r.text, by: r.by }));
}

/** The runner reached a checkpoint with a pause request: it is now actually paused. */
export async function markPaused(db: Db, itemId: string) {
  await db.runItem.updateMany({ where: { id: itemId, pause: "REQUESTED" }, data: { pause: "PAUSED", currentStep: "Paused by a person" } });
}

/** Clear any leftover control state when a case ends. */
export async function clearControl(db: Db, itemId: string) {
  await db.runItem.updateMany({ where: { id: itemId }, data: { pause: "NONE", takeover: "NONE" } });
  await db.agentCommand.updateMany({ where: { runItemId: itemId, handledAt: null }, data: { handledAt: new Date() } });
  await db.liveInput.deleteMany({ where: { runItemId: itemId } });
}
