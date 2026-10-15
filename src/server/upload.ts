import "server-only";
import { badRequest } from "@/server/http";

/** Read a file from multipart form data with a size limit. */
export async function readUpload(form: FormData, field: string, maxBytes: number) {
  const f = form.get(field);
  if (!f || typeof f === "string") throw badRequest(`No file uploaded in "${field}".`);
  if (f.size === 0) throw badRequest("The uploaded file is empty.");
  if (f.size > maxBytes) throw badRequest(`File is larger than the ${(maxBytes / 1048576).toFixed(0)} MB limit.`);
  return { name: f.name || "upload", bytes: Buffer.from(await f.arrayBuffer()) };
}

export function formJson<T = unknown>(form: FormData, field: string): T | undefined {
  const v = form.get(field);
  if (v === null || v === "") return undefined;
  if (typeof v !== "string") throw badRequest(`Field "${field}" must be text.`);
  try {
    return JSON.parse(v) as T;
  } catch {
    throw badRequest(`Field "${field}" is not valid JSON.`);
  }
}

export async function readForm(req: Request): Promise<FormData> {
  try {
    return await req.formData();
  } catch {
    throw badRequest("Expected multipart form data.");
  }
}

export const importMaxBytes = () => Number(process.env.IMPORT_MAX_BYTES || 10 * 1024 * 1024);
