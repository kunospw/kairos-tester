import type { Db } from "@/server/db";
import { badRequest, conflict, notFound } from "@/server/errors";
import {
  ALLOWED_EVIDENCE_DESCRIPTION,
  detectEvidenceType,
  getEvidenceStorage,
  maxEvidenceBytes,
  safeDisplayName,
  sha256,
  type EvidenceStorage,
} from "@/server/storage/evidence-storage";

export async function addEvidence(
  db: Db,
  attemptId: string,
  file: { name: string; bytes: Buffer },
  caption: string | null,
  user: string,
  storage: EvidenceStorage = getEvidenceStorage(),
) {
  const attempt = await db.executionAttempt.findUnique({ where: { id: attemptId } });
  if (!attempt) throw notFound("Attempt not found.");
  if (attempt.status === "COMPLETED") {
    throw conflict("Evidence can only be added while an attempt is open. Start a retest to record new evidence.");
  }
  if (file.bytes.length === 0) throw badRequest("The file is empty.");
  const max = maxEvidenceBytes();
  if (file.bytes.length > max) throw badRequest(`File is larger than the ${(max / 1048576).toFixed(0)} MB limit.`);
  const type = detectEvidenceType(file.bytes, file.name);
  if (!type) throw badRequest(`Unsupported file type. Allowed: ${ALLOWED_EVIDENCE_DESCRIPTION}.`);

  const key = await storage.save(file.bytes, type.ext);
  return db.evidence.create({
    data: {
      attemptId,
      storageKey: key,
      originalName: safeDisplayName(file.name),
      mimeType: type.mime,
      sizeBytes: file.bytes.length,
      sha256: sha256(file.bytes),
      caption: caption?.trim() || null,
      isSimulated: attempt.isSimulated,
      uploadedBy: user,
    },
  });
}

export async function readEvidence(db: Db, evidenceId: string, storage: EvidenceStorage = getEvidenceStorage()) {
  const ev = await db.evidence.findUnique({ where: { id: evidenceId } });
  if (!ev) throw notFound("Evidence not found.");
  let bytes: Buffer;
  try {
    bytes = await storage.read(ev.storageKey);
  } catch {
    throw notFound("Evidence file is missing from storage. Restore the evidence folder from backup (see README).");
  }
  return { evidence: ev, bytes };
}
