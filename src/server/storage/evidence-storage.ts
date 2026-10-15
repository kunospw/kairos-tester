// Evidence file storage behind a replaceable interface. The default
// implementation writes to a local directory outside public/ using generated
// names; database rows (Evidence) hold the metadata and storage key.

import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export interface EvidenceStorage {
  /** Persist bytes and return the generated storage key. */
  save(data: Buffer, ext: string): Promise<string>;
  read(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  describe(): string;
}

export interface DetectedType {
  mime: string;
  ext: string;
}

const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|gif|webp|pdf|txt|log|csv|json|har|mp4|webm)$/;

export function isValidStorageKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

const TEXT_EXT: Record<string, string> = {
  txt: "text/plain",
  log: "text/plain",
  csv: "text/csv",
  json: "application/json",
  har: "application/json",
};

/**
 * Determine the file type from its content (not the client-supplied MIME).
 * Text files are accepted only for known text extensions and must be valid
 * UTF-8 without NUL bytes. Returns null for unsupported content.
 */
export function detectEvidenceType(data: Buffer, originalName: string): DetectedType | null {
  const b = data;
  const starts = (...bytes: number[]) => bytes.every((v, i) => b[i] === v);
  if (b.length >= 8 && starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { mime: "image/png", ext: "png" };
  if (b.length >= 3 && starts(0xff, 0xd8, 0xff)) return { mime: "image/jpeg", ext: "jpg" };
  if (b.length >= 6 && (b.subarray(0, 6).toString("latin1") === "GIF87a" || b.subarray(0, 6).toString("latin1") === "GIF89a"))
    return { mime: "image/gif", ext: "gif" };
  if (b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP")
    return { mime: "image/webp", ext: "webp" };
  if (b.length >= 5 && b.subarray(0, 5).toString("latin1") === "%PDF-") return { mime: "application/pdf", ext: "pdf" };
  if (b.length >= 12 && b.subarray(4, 8).toString("latin1") === "ftyp") return { mime: "video/mp4", ext: "mp4" };
  if (b.length >= 4 && starts(0x1a, 0x45, 0xdf, 0xa3)) return { mime: "video/webm", ext: "webm" };

  const ext = path.extname(originalName).slice(1).toLowerCase();
  if (TEXT_EXT[ext]) {
    if (b.includes(0)) return null;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(b);
    } catch {
      return null;
    }
    return { mime: TEXT_EXT[ext], ext };
  }
  return null;
}

export const ALLOWED_EVIDENCE_DESCRIPTION =
  "PNG, JPEG, GIF, WebP, PDF, MP4/WebM, or UTF-8 text (.txt, .log, .csv, .json, .har)";

export function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Strip path components and control characters from a client file name (display only). */
export function safeDisplayName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f"<>|*?:]/g, "_").trim();
  return (cleaned || "file").slice(0, 200);
}

export class LocalEvidenceStorage implements EvidenceStorage {
  private root: string;

  constructor(dir: string) {
    this.root = path.resolve(dir);
  }

  private resolveKey(key: string): string {
    if (!isValidStorageKey(key)) throw new Error("Invalid storage key.");
    const full = path.resolve(this.root, key.slice(0, 2), key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Invalid storage path.");
    return full;
  }

  async save(data: Buffer, ext: string): Promise<string> {
    const key = `${randomUUID()}.${ext}`;
    const full = this.resolveKey(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data, { flag: "wx" });
    return key;
  }

  async read(key: string): Promise<Buffer> {
    return fs.readFile(this.resolveKey(key));
  }

  async remove(key: string): Promise<void> {
    await fs.rm(this.resolveKey(key), { force: true });
  }

  describe(): string {
    return `Local files in ${this.root}`;
  }
}

let instance: EvidenceStorage | null = null;

export function evidenceDir(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.EVIDENCE_DIR || "./storage/evidence");
}

export function getEvidenceStorage(): EvidenceStorage {
  if (!instance) instance = new LocalEvidenceStorage(evidenceDir());
  return instance;
}

export function maxEvidenceBytes(): number {
  return Number(process.env.EVIDENCE_MAX_BYTES || 10 * 1024 * 1024);
}
