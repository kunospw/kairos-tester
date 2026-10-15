// A person taking over the runner's browser from the live view. The AI pauses while
// the person drives; whatever they did is flagged so the result is never auto-passed.
import { z } from "zod";
import type { Db } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";
import { conflict, notFound } from "@/server/errors";

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

export const controlSchema = z.object({ itemId: z.string().min(1), action: z.enum(["take", "give_back"]) });
export const inputBatchSchema = z.object({ itemId: z.string().min(1), events: z.array(liveInputSchema).min(1).max(MAX_EVENTS) });

async function runningItem(db: Db, applicationId: string, runId: string, itemId: string) {
  const item = await db.runItem.findFirst({
    where: { id: itemId, runId, run: { cycle: { applicationId } } },
    select: { id: true, status: true, takeover: true, runId: true },
  });
  if (!item) throw notFound("Run item not found.");
  return item;
}

export async function setControl(db: Db, applicationId: string, runId: string, input: z.infer<typeof controlSchema>, user: string) {
  const item = await runningItem(db, applicationId, runId, input.itemId);
  if (input.action === "take") {
    if (item.status !== "RUNNING") throw conflict("The AI is not running this case right now.");
    if (item.takeover === "NONE") {
      await db.runItem.update({ where: { id: item.id }, data: { takeover: "REQUESTED" } });
      await db.runEvent.create({ data: { runId, runItemId: item.id, message: `${user} asked to take over the browser.` } });
    }
    return { takeover: item.takeover === "NONE" ? "REQUESTED" : item.takeover };
  }
  await db.runItem.update({ where: { id: item.id }, data: { takeover: "NONE" } });
  await db.liveInput.deleteMany({ where: { runItemId: item.id } });
  return { takeover: "NONE" as const };
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
