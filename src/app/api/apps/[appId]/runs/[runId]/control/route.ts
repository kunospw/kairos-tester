import { api, parseJson } from "@/server/http";
import { getPrisma } from "@/server/db";
import { controlSchema, setControl } from "@/server/services/live-control";

// Session-only (no agent token): only a signed-in person can take over the browser.
export const POST = api<{ params: Promise<{ appId: string; runId: string }> }>(async (req, { params, user }) => {
  const { appId, runId } = await params;
  return setControl(getPrisma(), appId, runId, await parseJson(req, controlSchema), user.displayName);
});
