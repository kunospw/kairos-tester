import { api } from "@/server/http";
import { getPrisma } from "@/server/db";
import { readEvidence } from "@/server/services/evidence-service";

const INLINE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "video/mp4", "video/webm"]);

// Authenticated evidence download. Files are served from private storage, never public/.
export const GET = api<{ params: Promise<{ evidenceId: string }> }>(async (req, { params }) => {
  const { evidenceId } = await params;
  const { evidence, bytes } = await readEvidence(getPrisma(), evidenceId);
  const download = new URL(req.url).searchParams.get("download") === "1" || !INLINE.has(evidence.mimeType);
  const isText = evidence.mimeType.startsWith("text/") || evidence.mimeType === "application/json";
  const type = isText ? "text/plain; charset=utf-8" : evidence.mimeType;
  const asciiName = evidence.originalName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  const disposition = `${download ? "attachment" : "inline"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(evidence.originalName)}`;
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": type,
      "Content-Length": String(bytes.length),
      "Content-Disposition": disposition,
      "Cache-Control": "private, no-store",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
