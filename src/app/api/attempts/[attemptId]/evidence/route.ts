import { api, isAgent, HttpError } from "@/server/http";
import { getPrisma } from "@/server/db";
import { readForm, readUpload } from "@/server/upload";
import { addEvidence } from "@/server/services/evidence-service";
import { maxEvidenceBytes } from "@/server/storage/evidence-storage";

export const POST = api<{ params: Promise<{ attemptId: string }> }>(async (req, { params, user }) => {
  const { attemptId } = await params;
  if (isAgent(user)) {
    const a = await getPrisma().executionAttempt.findUnique({ where: { id: attemptId }, select: { executionMethod: true } });
    if (a?.executionMethod !== "AI_DRIVEN") throw new HttpError(403, "The agent may only add evidence to its own AI-driven runs.");
  }
  const form = await readForm(req);
  const file = await readUpload(form, "file", maxEvidenceBytes());
  const caption = (form.get("caption") as string | null) ?? null;
  const ev = await addEvidence(getPrisma(), attemptId, file, caption, user.displayName);
  return { id: ev.id, originalName: ev.originalName, mimeType: ev.mimeType, sizeBytes: ev.sizeBytes };
}, { agent: true });
