import { NextResponse } from "next/server";
import { destroySession } from "@/server/auth/session";
import { errorResponse } from "@/server/http";

export async function POST() {
  try {
    await destroySession();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
