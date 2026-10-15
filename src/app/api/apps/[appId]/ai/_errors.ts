import "server-only";
import { NextResponse } from "next/server";
import { AiError } from "@/server/ai/ollama";

/** Run an AI action; provider failures become a clear 502 with a code. Nothing is saved on failure. */
export async function withAi<T>(fn: () => Promise<T>): Promise<T | Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AiError) {
      const status = e.code === "not_configured" ? 503 : 502;
      return NextResponse.json({ error: e.message, code: e.code, details: e.details }, { status });
    }
    throw e;
  }
}
