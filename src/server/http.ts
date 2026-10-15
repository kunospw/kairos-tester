import "server-only";
import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { createHash, timingSafeEqual } from "node:crypto";
import { getSession, type SessionUser } from "@/server/auth/session";

import { HttpError, badRequest } from "@/server/errors";
export { HttpError, badRequest, notFound, conflict } from "@/server/errors";

/** Reject cross-site state-changing requests (defence in depth on top of SameSite cookies). */
function checkOrigin(req: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin) return; // non-browser clients; the session cookie is still required
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    if (new URL(origin).host !== host) throw new HttpError(403, "Cross-origin request rejected.");
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(403, "Invalid origin.");
  }
}

type Handler<C> = (req: Request, ctx: C & { user: SessionUser }) => Promise<Response | unknown>;

export const AGENT_USER: SessionUser = { username: "agent", displayName: "Claude (AI agent)", sessionId: "agent" };

/**
 * Optional bearer token for an AI agent (AGENT_TOKEN_HASH = sha256 hex of the token).
 * Accepted only on routes that opt in with { agent: true }. Never valid for completing attempts.
 */
function agentFromHeader(req: Request): SessionUser | null {
  const expected = process.env.AGENT_TOKEN_HASH?.trim().toLowerCase();
  const auth = req.headers.get("authorization");
  if (!expected || !auth?.startsWith("Bearer ")) return null;
  const got = createHash("sha256").update(auth.slice(7).trim()).digest("hex");
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? AGENT_USER : null;
}

export const isAgent = (user: SessionUser) => user.sessionId === "agent";

/** Wrap an API route: requires a valid session (or, where allowed, the agent token), maps errors to JSON. */
export function api<C extends { params: Promise<Record<string, string>> }>(handler: Handler<C>, opts: { agent?: boolean } = {}) {
  return async (req: Request, ctx: C): Promise<Response> => {
    try {
      checkOrigin(req);
      const user = (await getSession()) ?? (opts.agent ? agentFromHeader(req) : null);
      if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
      const result = await handler(req, { ...ctx, user });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) {
    return NextResponse.json({ error: e.message, details: e.details }, { status: e.status });
  }
  if (e instanceof ZodError) {
    return NextResponse.json(
      { error: "Invalid input.", details: e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`) },
      { status: 400 },
    );
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (/DATABASE_URL|ECONNREFUSED|Can't reach database|connect ECONN/i.test(msg)) {
    return NextResponse.json({ error: "Database unavailable. Check DATABASE_URL and that PostgreSQL is running." }, { status: 503 });
  }
  console.error("[api] unhandled error:", msg);
  return NextResponse.json({ error: "Unexpected server error." }, { status: 500 });
}

export async function parseJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw badRequest("Request body must be JSON.");
  }
  return schema.parse(body);
}
