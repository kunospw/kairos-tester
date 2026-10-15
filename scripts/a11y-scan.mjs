// WCAG 2.2 AA scan of the running app with axe-core. Finds pages by following links, so it needs no ids.
//   npm run dev   (in another terminal, with a seeded account)
//   A11Y_USER=... A11Y_PASSWORD=... npm run a11y        (A11Y_URL defaults to http://localhost:3000)
// Needs a Chromium: set CHROME=/path/to/chrome, or let playwright-core find the installed one.
import { chromium } from "playwright-core";
import { AxeBuilder } from "@axe-core/playwright";

const base = (process.env.A11Y_URL ?? "http://localhost:3000").replace(/\/$/, "");
const user = process.env.A11Y_USER;
const password = process.env.A11Y_PASSWORD;
const limit = Number(process.env.A11Y_PAGES ?? 40);
if (!user || !password) {
  console.error("Set A11Y_USER and A11Y_PASSWORD (an account in the dev database).");
  process.exit(2);
}
const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const skip = /^\/(api|login|logout)(\/|$)/;
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
let failed = 0;
for (const [label, viewport] of [["desktop", { width: 1440, height: 900 }], ["phone", { width: 375, height: 812 }]]) {
  const page = await (await browser.newContext({ viewport })).newPage();
  await page.goto(`${base}/login`);
  await page.getByLabel(/user/i).fill(user);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
  const seen = new Set();
  const queue = ["/"];
  while (queue.length && seen.size < limit) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    await page.goto(base + path, { waitUntil: "load" });
    await page.waitForTimeout(1200);
    const res = await new AxeBuilder({ page }).withTags(tags).analyze();
    console.log(`${label.padEnd(7)} ${path}  ${res.violations.length ? "" : "ok"}`);
    for (const v of res.violations) {
      failed += v.nodes.length;
      console.log(`  ${v.id} (${v.impact}): ${v.help}`);
      for (const n of v.nodes.slice(0, 3)) console.log(`    ${n.target.join(" ")}  ${(n.any[0]?.message ?? "").slice(0, 120)}`);
    }
    const hrefs = await page.$$eval("a[href^='/']", (as) => as.map((a) => a.getAttribute("href")));
    for (const h of hrefs) {
      const p = h.split("#")[0].split("?")[0];
      if (p && !skip.test(p) && !seen.has(p)) queue.push(p);
    }
  }
}
await browser.close();
console.log(failed ? `\n${failed} accessibility problem(s)` : "\nNo accessibility problems found");
process.exit(failed ? 1 : 0);
