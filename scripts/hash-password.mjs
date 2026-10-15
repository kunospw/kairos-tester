// Generates a TESTER_PASSWORD_HASH value for .env.
// Usage (PowerShell):  npm run hash-password
// The password is read from the terminal without echo and is never stored.
import { randomBytes, scryptSync } from "node:crypto";
import readline from "node:readline";

function ask(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(prompt)) rl.output.write(s); };
    rl.question(prompt, (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer); });
  });
}

const pw = process.env.KT_PASSWORD ?? (await ask("New tester password (min 10 chars): "));
if (!pw || pw.length < 10) { console.error("Password must be at least 10 characters."); process.exit(1); }
if (!process.env.KT_PASSWORD) {
  const again = await ask("Repeat password: ");
  if (again !== pw) { console.error("Passwords do not match."); process.exit(1); }
}
const N = 2 ** 15, r = 8, p = 1;
const salt = randomBytes(16);
const key = scryptSync(pw, salt, 64, { N, r, p, maxmem: 128 * N * r * 2 });
const hash = ["scrypt", N, r, p, salt.toString("base64url"), key.toString("base64url")].join(":");
console.log("\nAdd this line to .env :\n");
console.log(`TESTER_PASSWORD_HASH="${hash}"`);
