// scrypt password hashing (Node built-in). Format:
//   scrypt:<N>:<r>:<p>:<salt base64url>:<hash base64url>
// (":" rather than "$", because Next.js expands $VAR sequences in .env files.)
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const scrypt = (pw: string, salt: Buffer, len: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(pw, salt, len, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 128 * N * R * 2;

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 10) throw new Error("Password must be at least 10 characters.");
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return ["scrypt", N, R, P, salt.toString("base64url"), key.toString("base64url")].join(":");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, "base64url");
  const N_ = Number(n), r_ = Number(r), p_ = Number(p);
  if (!expected.length || ![N_, r_, p_].every(Number.isInteger)) return false;
  const key = await scrypt(password, Buffer.from(saltB64, "base64url"), expected.length, {
    N: N_,
    r: r_,
    p: p_,
    maxmem: 128 * N_ * r_ * 2,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}
