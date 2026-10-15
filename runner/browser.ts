// Browser side of the runner: safe navigation, sign-in, role switching and
// deterministic checks. Everything here is generic and driven by the
// environment's agent profile.
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { accountForRole, isAllowedUrl, type AgentProfile } from "@/lib/agent-profile";
import type { AgentAction, CheckRecord } from "@/lib/agent-protocol";

/** Buttons/links that remove, delete, archive or reset something. */
const DESTRUCTIVE_CONTROL = /\b(delete|remove|archive|purge|wipe|reset|deactivate|revoke|unassign)\b/i;

export function findChrome(): string {
  if (process.env.RUNNER_BROWSER_PATH) return process.env.RUNNER_BROWSER_PATH;
  const root = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
  const dirs = fs.existsSync(root) ? fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const d of dirs) {
    const exe = path.join(root, d, "chrome-win64", "chrome.exe");
    if (fs.existsSync(exe)) return exe;
  }
  throw new Error("No Chromium found. Set RUNNER_BROWSER_PATH, or run: npx playwright install chromium");
}

export async function launch(): Promise<Browser> {
  return chromium.launch({ executablePath: findChrome(), headless: process.env.RUNNER_HEADED !== "true" });
}

export class Session {
  page!: Page;
  private context!: BrowserContext;
  signedIn = false;
  actingAs: string | null = null;
  /** Overlay buttons to click away; cleared for cases that test those overlays (e.g. tours). */
  autoDismiss: string[] = [];
  private startedAt = new Date().toISOString();
  /** Receives JPEG frames of the page as it changes (live view). Set before open(). */
  onFrame: ((jpeg: Buffer) => void) | null = null;

  constructor(
    private browser: Browser,
    private profile: AgentProfile,
    caseText = "",
  ) {
    const text = caseText.toLowerCase();
    // "Skip tour" -> "tour": leave tours alone when the case is about tours.
    this.autoDismiss = profile.autoDismiss.filter((label) => {
      const noun = label.toLowerCase().split(/\s+/).pop() ?? "";
      return !noun || !text.includes(noun);
    });
  }

  async open() {
    this.context = await this.browser.newContext({ viewport: { width: 1366, height: 900 } });
    // Hard guard: block every request to another origin (except the app's own assets).
    const origin = new URL(this.profile.baseUrl).origin;
    await this.context.route("**/*", (route) => {
      const u = route.request().url();
      if (u.startsWith(origin) || u.startsWith("data:") || u.startsWith("blob:")) return route.continue();
      return route.abort();
    });
    this.startedAt = new Date(Date.now() - 1000).toISOString();
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(15_000);
    await this.startScreencast();
  }

  /** Chrome sends a frame only when the page changes, so an idle page costs nothing. Best effort. */
  private async startScreencast() {
    if (!this.onFrame) return;
    try {
      const cdp = await this.context.newCDPSession(this.page);
      cdp.on("Page.screencastFrame", (f) => {
        cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
        this.onFrame?.(Buffer.from(f.data, "base64"));
      });
      await cdp.send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: 1366, maxHeight: 900, everyNthFrame: 2 });
    } catch {
      /* the live view is optional; the run carries on without it */
    }
  }

  async close() {
    await this.context?.close().catch(() => {});
  }

  async settle() {
    await this.page.waitForLoadState("load").catch(() => {});
    await this.page.locator("main, body").first().waitFor({ timeout: 15_000 }).catch(() => {});
    await this.page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
    await this.page.waitForTimeout(400);
    // Clear overlays such as page tours that would otherwise block clicks (not when the case tests them).
    for (const name of this.autoDismiss) {
      const btn = this.page.getByRole("button", { name, exact: true }).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ timeout: 3000 }).catch(() => {});
        await this.page.waitForTimeout(300);
      }
    }
  }

  path() {
    const u = new URL(this.page.url());
    return u.pathname + u.search;
  }

  async snapshot(max = 12_000): Promise<string> {
    const s = await this.page.locator("body").ariaSnapshot().catch(() => "(snapshot unavailable)");
    return s.length > max ? s.slice(0, max) + "\n… (truncated)" : s;
  }

  async signIn(): Promise<string> {
    const si = this.profile.signIn;
    if (si.method === "none") {
      this.signedIn = true;
      return "This application needs no sign-in.";
    }
    const since = new Date().toISOString();
    await this.page.goto(new URL(si.loginPath, this.profile.baseUrl).toString());
    await this.settle();
    await this.page.getByLabel(si.emailLabel).fill(si.email);
    await this.page.getByRole("button", { name: si.sendButton }).click();
    await this.page.getByLabel(si.codeLabel).waitFor();
    const code = await readCode(si.outboxPath, si.email, since);
    await this.page.getByLabel(si.codeLabel).fill(code);
    await this.page.getByRole("button", { name: si.submitButton }).click();
    await this.page.waitForURL((u) => !u.pathname.startsWith(si.loginPath), { timeout: 20_000 });
    await this.settle();
    this.signedIn = true;
    this.actingAs = null;
    return `Signed in as ${si.email} (code read from the local code file). Now on ${this.path()}.`;
  }

  /** The newest sign-in code the app wrote to its local code file since this case started. */
  async readSignInCode(email?: string): Promise<string> {
    const si = this.profile.signIn;
    if (si.method !== "email_code_outbox") return "This application has no local code file; ask the person instead.";
    const to = email || si.email;
    try {
      const code = await readCode(si.outboxPath, to, this.startedAt);
      return `The newest sign-in code for ${to} is ${code}. (Read from the app's local code file; real email delivery is not tested.)`;
    } catch {
      return `No sign-in code for ${to} was written since this case started. Request one first (e.g. click the send-code button).`;
    }
  }

  async actAs(role: string): Promise<string> {
    const { known, account } = accountForRole(this.profile, role);
    if (!known) {
      return `Unknown role "${role}". Known roles: ${Object.keys(this.profile.roleAccounts).join(", ") || "(none configured)"}. Use the closest one or report BLOCKED.`;
    }
    if (!this.signedIn) await this.signIn();
    const rs = this.profile.roleSwitch;
    if (account === null) {
      if (this.actingAs && rs.method === "view_as") await this.returnToSelf();
      return `Acting as the signed-in account (${role}).`;
    }
    if (this.actingAs === account) return `Already acting as ${account}.`;
    if (rs.method !== "view_as") return `This environment has no way to switch to ${account}. Report BLOCKED.`;
    if (this.actingAs) await this.returnToSelf();
    await this.page.goto(new URL(rs.peoplePath, this.profile.baseUrl).toString());
    await this.settle();
    const row = this.page.getByRole("row").filter({ hasText: account }).first();
    await row.getByRole("button", { name: rs.buttonName }).click();
    await this.settle();
    this.actingAs = account;
    return `Now viewing the app as ${account} (${role}). On ${this.path()}.`;
  }

  private async returnToSelf() {
    const rs = this.profile.roleSwitch;
    if (rs.method !== "view_as") return;
    const btn = this.page.getByRole("button", { name: rs.returnButton });
    if (!(await btn.isVisible().catch(() => false))) await this.page.goto(this.profile.baseUrl);
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
      await this.settle();
    }
    this.actingAs = null;
  }

  /** Names of approved test files the AI may upload. */
  uploadableFiles(): string[] {
    const out: string[] = [];
    for (const dir of this.profile.uploadDirs) {
      try {
        for (const f of fs.readdirSync(dir)) if (fs.statSync(path.join(dir, f)).isFile()) out.push(f);
      } catch {
        /* folder missing: nothing to offer */
      }
    }
    return [...new Set(out)].sort();
  }

  private resolveUpload(file: string): string | null {
    const base = path.basename(file); // no folders, no traversal
    for (const dir of this.profile.uploadDirs) {
      const full = path.resolve(dir, base);
      if (full.startsWith(path.resolve(dir) + path.sep) && fs.existsSync(full)) return full;
    }
    return null;
  }

  /**
   * Hard guard: refuse delete/remove/archive-type actions on anything in the
   * profile's protected list. Looks at the clicked element's row, any open
   * dialog, and the page heading/breadcrumb.
   */
  private async protectedTarget(target: ReturnType<Page["getByRole"]>): Promise<string | null> {
    const names = this.profile.protectedNames;
    if (!names.length) return null;
    const context = await target
      .evaluate((el) => {
        const row = el.closest("tr, li, [role=row], [role=listitem]") ?? el.closest("form, article, section");
        const dialog = document.querySelector("[role=dialog], [role=alertdialog], dialog[open]");
        // Where am I: headings, breadcrumbs ("Breadcrumb", "You are here", …), the page header and title.
        const crumbs = [...document.querySelectorAll("nav[aria-label]")].filter((n) => /breadcrumb|you are here|location/i.test(n.getAttribute("aria-label") ?? ""));
        const heading = [
          ...[...document.querySelectorAll("h1")].map((n) => (n as HTMLElement).innerText),
          ...crumbs.map((n) => (n as HTMLElement).innerText),
          (document.querySelector("header") as HTMLElement | null)?.innerText.slice(0, 200) ?? "",
          document.title,
        ].join(" ");
        return [row ? (row as HTMLElement).innerText : "", dialog ? (dialog as HTMLElement).innerText : "", heading].join("\n");
      })
      .catch(() => "");
    const hay = context.toLowerCase();
    return names.find((n) => hay.includes(n.toLowerCase())) ?? null;
  }

  /**
   * Find a control: inside an open dialog first (dialogs block the page behind them),
   * and an exact accessible-name match before a partial one.
   */
  private async resolve(role: string, name: string, nth = 0) {
    const r = role as Parameters<Page["getByRole"]>[0];
    const dialog = this.page.locator("dialog[open], [role=dialog], [role=alertdialog]").filter({ visible: true }).last();
    const scopes = (await dialog.count()) ? [dialog, this.page] : [this.page];
    for (const scope of scopes) {
      for (const exact of [true, false]) {
        const l = scope.getByRole(r, { name, exact });
        if ((await l.count()) > nth) return l.nth(nth);
      }
    }
    return this.page.getByRole(r, { name }).nth(nth); // let the action report "not found"
  }

  private locate(role: string, name: string, nth = 0) {
    return this.page.getByRole(role as Parameters<Page["getByRole"]>[0], { name, exact: false }).nth(nth);
  }

  /** Execute one browser action. Returns a short description of what happened. */
  async perform(a: AgentAction): Promise<string> {
    switch (a.type) {
      case "goto": {
        const target = new URL(a.path, this.profile.baseUrl);
        if (!isAllowedUrl(this.profile, target.toString())) return `Refused: ${a.path} is outside the application under test.`;
        await this.page.goto(target.toString());
        await this.settle();
        return `Opened ${this.path()}.`;
      }
      case "click": {
        const target = await this.resolve(a.role, a.name, a.nth);
        if (DESTRUCTIVE_CONTROL.test(a.name)) {
          const hit = await this.protectedTarget(target);
          if (hit) return `REFUSED: "${a.name}" would affect "${hit}", which is protected. Create a scratch item (for example a new demo project) and use that instead, or finish BLOCKED.`;
        }
        await target.click();
        await this.settle();
        return `Clicked ${a.role} "${a.name}". Now on ${this.path()}.`;
      }
      case "fill": {
        const prot = this.profile.protectedNames.find((n) => n.toLowerCase() === a.value.trim().toLowerCase());
        if (prot && /delete|remove|archive|confirm|type/i.test(a.name)) {
          return `REFUSED: typing "${prot}" into "${a.name}" looks like confirming the deletion of a protected item. Use a scratch item instead.`;
        }
        await (await this.resolve(a.role, a.name)).fill(a.value);
        return `Filled ${a.role} "${a.name}".`;
      }
      case "upload": {
        const full = this.resolveUpload(a.file);
        if (!full) return `REFUSED: "${a.file}" is not one of the approved test files: ${this.uploadableFiles().join(", ") || "(none)"}.`;
        const dialog = this.page.locator("dialog[open], [role=dialog]").filter({ visible: true }).last();
        const scope = (await dialog.count()) ? dialog : this.page;
        const input = a.name ? scope.getByLabel(a.name).first() : scope.locator('input[type="file"]').first();
        await input.setInputFiles(full);
        await this.settle();
        return `Uploaded ${path.basename(full)}. Now on ${this.path()}.`;
      }
      case "select":
        await this.page.getByRole("combobox", { name: a.name }).selectOption({ label: a.option });
        await this.settle();
        return `Selected "${a.option}" in "${a.name}".`;
      case "press":
        if (/^(End|Home|PageUp|PageDown)$/i.test(a.key)) {
          return "Not needed: the snapshot already shows the WHOLE page, including parts below the fold. Use what is in the snapshot, or navigate elsewhere.";
        }
        await this.page.keyboard.press(a.key);
        await this.settle();
        return `Pressed ${a.key}.`;
      case "wait":
        await this.page.waitForTimeout(a.seconds * 1000);
        return `Waited ${a.seconds}s.`;
      default:
        return "Not a browser action.";
    }
  }

  async check(a: Extract<AgentAction, { type: "check" }>): Promise<CheckRecord> {
    const rec = (passed: boolean, detail: string): CheckRecord => ({ description: a.description, kind: a.kind, passed, detail });
    const byRole = () => (a.role && a.name ? this.locate(a.role, a.name) : null);
    switch (a.kind) {
      case "text_visible":
      case "text_absent": {
        if (!a.text) return rec(false, "no text given");
        const inText = await this.page.getByText(a.text, { exact: false }).filter({ visible: true }).count();
        // Text shown inside form fields (e.g. read-only answers) counts as visible too.
        const needle = a.text.toLowerCase();
        const inFields = await this.page
          .locator("input:visible, textarea:visible, select:visible")
          .evaluateAll((els, t) => els.filter((e) => ((e as HTMLInputElement).value ?? "").toLowerCase().includes(t)).length, needle);
        const n = inText + inFields;
        return a.kind === "text_visible" ? rec(n > 0, n > 0 ? `found "${a.text}"` : `"${a.text}" not found`) : rec(n === 0, n === 0 ? `"${a.text}" absent` : `"${a.text}" is visible`);
      }
      case "url_contains": {
        const ok = Boolean(a.text) && this.page.url().includes(a.text!);
        return rec(ok, `URL is ${this.path()}`);
      }
      case "element_visible":
      case "element_absent": {
        const l = byRole();
        if (!l) return rec(false, "role and name required");
        const n = await this.page.getByRole(a.role as Parameters<Page["getByRole"]>[0], { name: a.name }).filter({ visible: true }).count();
        return a.kind === "element_visible" ? rec(n > 0, n > 0 ? `${a.role} "${a.name}" visible` : `${a.role} "${a.name}" not found`) : rec(n === 0, n === 0 ? `${a.role} "${a.name}" absent` : `${a.role} "${a.name}" is visible`);
      }
      case "element_disabled":
      case "element_enabled": {
        const l = byRole();
        if (!l) return rec(false, "role and name required");
        if (!(await l.count())) return rec(false, `${a.role} "${a.name}" not found`);
        const enabled = await l.isEnabled();
        return a.kind === "element_enabled" ? rec(enabled, enabled ? "enabled" : "disabled") : rec(!enabled, enabled ? "enabled" : "disabled");
      }
    }
  }

  async screenshot(): Promise<Buffer> {
    return this.page.screenshot({ fullPage: true });
  }
}

async function readCode(outbox: string, email: string, since: string): Promise<string> {
  for (let i = 0; i < 100; i++) {
    if (fs.existsSync(outbox)) {
      const lines = fs.readFileSync(outbox, "utf8").split("\n").filter(Boolean);
      const hit = lines
        .map((l) => {
          try {
            return JSON.parse(l) as { to: string; code: string; at: string };
          } catch {
            return null;
          }
        })
        .filter((e): e is { to: string; code: string; at: string } => Boolean(e && e.to?.toLowerCase() === email.toLowerCase() && e.at >= since))
        .pop();
      if (hit) return hit.code;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`No sign-in code for ${email} appeared in the code file.`);
}
