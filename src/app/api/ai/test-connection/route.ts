import { NextResponse } from "next/server";
import { api } from "@/server/http";
import { AiError } from "@/server/ai/ollama";
import { testConnection } from "@/server/services/ai-service";

export const POST = api(async () => {
  try {
    return await testConnection();
  } catch (e) {
    if (e instanceof AiError) return NextResponse.json({ ok: false, error: e.message, code: e.code }, { status: 200 });
    throw e;
  }
});
