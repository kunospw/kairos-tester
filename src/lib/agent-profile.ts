// Per-environment instructions for the AI runner: where the app is, how to sign in,
// how to act as a role, and what it must never touch. Data, not code, so any
// application can be configured without changing Kairos Tester.
import { z } from "zod";

/** Credentials come from the runner's own environment, never from the database. Only KT_ names, so a profile can't read other secrets. */
const credentialVar = z
  .string()
  .trim()
  .regex(/^KT_[A-Z0-9_]{1,60}$/, "Credential variable names must start with KT_ (for example KT_KFMS_PASSWORD).");

/** A plain host name the page may call (https only, no port, path or wildcard). */
const apiHost = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/, "Use a plain host name such as api.example.com (no https://, port or path).");

export const agentProfileSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .url()
    .refine((u) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/i.test(u), "For now the AI runner only drives applications on this computer (localhost)."),
  signIn: z.discriminatedUnion("method", [
    z.object({ method: z.literal("none") }),
    /** Username + password sign-in. The values are read from the runner's environment variables named here. */
    z.object({
      method: z.literal("password"),
      loginPath: z.string().trim().default("/sign-in"),
      usernameField: z.string().trim().default("Username"),
      passwordField: z.string().trim().default("Password"),
      submitButton: z.string().trim().default("Sign In"),
      usernameEnv: credentialVar,
      passwordEnv: credentialVar,
    }),
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
  /**
   * Extra hosts the page itself may call (for example the application's own API), https only.
   * The AI still can only open pages on baseUrl; this only lets that page reach its backend.
   */
  allowedHosts: z.array(apiHost).max(5).default([]),
  /** Look only: every request that would change data (POST/PUT/PATCH/DELETE) to an allowed host is blocked in the browser. */
  readOnly: z.boolean().default(false),
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

/**
 * Decides whether the runner's browser may send a request. Used as a hard guard on every request.
 * Same origin as the application: yes. data:/blob:: yes. An allowed API host (https): yes, but in read-only
 * mode only reads, SignalR connection set-up, and the sign-in itself. Anything else: no.
 */
export function isRequestAllowed(profile: AgentProfile, rawUrl: string, method: string, opts: { signingIn?: boolean } = {}): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  if (u.protocol === "data:" || u.protocol === "blob:") return true;
  if (u.origin === new URL(profile.baseUrl).origin) return true;
  if (u.protocol !== "https:" || !profile.allowedHosts.includes(u.hostname.toLowerCase())) return false;
  if (!profile.readOnly) return true;
  if (["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) return true;
  if (opts.signingIn) return true;
  return /\/negotiate\/?$/i.test(u.pathname); // SignalR connection set-up is not a data change
}

export function accountForRole(profile: AgentProfile, role: string | null | undefined): { known: boolean; account: string | null } {
  if (!role) return { known: true, account: null };
  const key = Object.keys(profile.roleAccounts).find((k) => k.toLowerCase() === role.trim().toLowerCase());
  return key === undefined ? { known: false, account: null } : { known: true, account: profile.roleAccounts[key] };
}
