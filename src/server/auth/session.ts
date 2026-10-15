import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPrisma } from "@/server/db";
import { verifyPassword } from "@/server/auth/password";

export const SESSION_COOKIE = "kt_session";

export interface SessionUser {
  username: string;
  displayName: string;
  sessionId: string;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const ttlHours = () => Math.max(1, Number(process.env.SESSION_TTL_HOURS || 12));

export function authConfigured(): boolean {
  return Boolean(process.env.TESTER_USERNAME?.trim() && process.env.TESTER_PASSWORD_HASH?.trim());
}

export function displayName(): string {
  return process.env.TESTER_DISPLAY_NAME?.trim() || process.env.TESTER_USERNAME?.trim() || "Tester";
}

/** Verify credentials against the single configured tester account. */
export async function checkCredentials(username: string, password: string): Promise<boolean> {
  const expectedUser = process.env.TESTER_USERNAME?.trim();
  const hash = process.env.TESTER_PASSWORD_HASH?.trim();
  if (!expectedUser || !hash) return false;
  // Always run the hash so timing does not reveal whether the username matched.
  const pwOk = await verifyPassword(password, hash);
  return pwOk && username.trim().toLowerCase() === expectedUser.toLowerCase();
}

export async function createSession(username: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlHours() * 3600_000);
  const prisma = getPrisma();
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await prisma.session.create({ data: { tokenHash: sha256(token), username, expiresAt } });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    expires: expiresAt,
  });
}

export async function getSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await getPrisma().session.findUnique({ where: { tokenHash: sha256(token) } });
  if (!session || session.expiresAt < new Date()) return null;
  // The account is defined by configuration; a session for a removed/renamed
  // account is no longer valid.
  if (session.username.toLowerCase() !== (process.env.TESTER_USERNAME ?? "").trim().toLowerCase()) return null;
  return { username: session.username, displayName: displayName(), sessionId: session.id };
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await getPrisma().session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(SESSION_COOKIE);
}

/** For server components/pages: redirect to /login when not signed in. */
export async function requirePageSession(): Promise<SessionUser> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}
