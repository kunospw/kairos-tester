import { NextResponse } from "next/server";
import { z } from "zod";
import { authConfigured, checkCredentials, createSession } from "@/server/auth/session";
import { errorResponse } from "@/server/http";

const schema = z.object({ username: z.string().max(200), password: z.string().max(500) });

// Simple in-memory throttle for repeated failures (single local user).
const failures = new Map<string, { count: number; until: number }>();

export async function POST(req: Request) {
  try {
    if (!authConfigured()) {
      return NextResponse.json(
        { error: "No tester account is configured. Set TESTER_USERNAME and TESTER_PASSWORD_HASH in .env (see README)." },
        { status: 503 },
      );
    }
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
    const f = failures.get(ip);
    if (f && f.until > Date.now()) {
      return NextResponse.json({ error: "Too many failed attempts. Wait a minute and try again." }, { status: 429 });
    }
    const body = schema.parse(await req.json());
    if (!(await checkCredentials(body.username, body.password))) {
      const count = (f?.count ?? 0) + 1;
      failures.set(ip, { count, until: count >= 5 ? Date.now() + 60_000 : 0 });
      return NextResponse.json({ error: "Incorrect username or password." }, { status: 401 });
    }
    failures.delete(ip);
    await createSession(process.env.TESTER_USERNAME!.trim());
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
