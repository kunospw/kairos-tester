import { api } from "@/server/http";
import { getPrisma } from "@/server/db";
import { liveFrame } from "@/server/services/run-service";

// Latest frame of the runner's browser for this run (JPEG), or 204 when nothing is live.
export const GET = api<{ params: Promise<{ appId: string; runId: string }> }>(async (_req, { params }) => {
  const { appId, runId } = await params;
  const f = await liveFrame(getPrisma(), appId, runId);
  if (!f) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  return new Response(new Uint8Array(f.jpeg), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-At": f.at.toISOString(),
      "X-Run-Item": f.runItemId,
    },
  });
});
