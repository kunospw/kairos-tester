// Per-environment instructions for the AI runner: where the app is, how to sign in,
// how to act as a role, and what it must never touch. Data, not code, so any
// application can be configured without changing Kairos Tester.
import { z } from "zod";

export const agentProfileSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .url()
    .refine((u) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/i.test(u), "For now the AI runner only drives applications on this computer (localhost)."),
  signIn: z.discriminatedUnion("method", [
    z.object({ method: z.literal("none") }),
    z.object({
      method: z.literal("email_code_outbox"),
      loginPath: z.string().trim().default("/login"),
      email: z.string().trim().email(),
      emailLabel: z.string().trim().default("Email"),
      sendButton: z.string().trim().default("Send me a code"),
      codeLabel: z.string().trim().default("Code"),
      submitButton: z.string().trim().default("Sign in"),
      /** Local dev file where the app writes sign-in codes (JSON lines: {to, code, at}). */
      outboxPath: z
        .string()
        .trim()
        .refine((p) => /\.jsonl$/i.test(p), "The code file must be a .jsonl file."),
    }),
  ]),
  roleSwitch: z.discriminatedUnion("method", [
    z.object({ method: z.literal("none") }),
    z.object({
      method: z.literal("view_as"),
      peoplePath: z.string().trim().default("/admin/people"),
      buttonName: z.string().trim().default("View as"),
      returnButton: z.string().trim().default("Return to admin"),
    }),
  ]),
  /** Case "Env" labels this environment can run (e.g. ["Demo"]). Empty = cases with any label. */
  caseEnvironments: z.array(z.string().trim().min(1)).default([]),
  /** Role name used in test cases -> account to act as (null = the signed-in account itself). */
  roleAccounts: z.record(z.string(), z.string().nullable()).default({}),
  /** Things the AI may never delete, archive or remove (enforced by the runner, not just asked). */
  protectedNames: z.array(z.string().trim().min(1)).default([]),
  /** Folders on this computer the AI may upload files from (test data only). */
  uploadDirs: z.array(z.string().trim().min(1)).default([]),
  /** Buttons the runner clicks away automatically when they appear (e.g. "Skip tour"). */
  autoDismiss: z.array(z.string().trim().min(1)).default([]),
  /** Plain-language guidance for the AI (test data, quirks). */
  notes: z.string().trim().max(8000).default(""),
});
export type AgentProfile = z.infer<typeof agentProfileSchema>;

export function parseProfile(raw: unknown): AgentProfile | null {
  const r = agentProfileSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/** True if `url` stays on the profile's host. The runner refuses any other navigation. */
export function isAllowedUrl(profile: AgentProfile, url: string): boolean {
  try {
    const target = new URL(url, profile.baseUrl);
    return target.origin === new URL(profile.baseUrl).origin;
  } catch {
    return false;
  }
}

export function accountForRole(profile: AgentProfile, role: string | null | undefined): { known: boolean; account: string | null } {
  if (!role) return { known: true, account: null };
  const key = Object.keys(profile.roleAccounts).find((k) => k.toLowerCase() === role.trim().toLowerCase());
  return key === undefined ? { known: false, account: null } : { known: true, account: profile.roleAccounts[key] };
}
