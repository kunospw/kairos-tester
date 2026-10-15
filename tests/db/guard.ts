import "dotenv/config";

/**
 * The DB tests delete data. Refuse to run unless TEST_DATABASE_URL points at a
 * separate database whose name contains "test" and differs from DATABASE_URL.
 */
export function assertDisposableTestDb(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set. DB tests need a dedicated disposable database (see README).");
  const dbName = new URL(url).pathname.replace(/^\//, "");
  const mainName = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).pathname.replace(/^\//, "") : null;
  const sameServer = process.env.DATABASE_URL && new URL(process.env.DATABASE_URL).host === new URL(url).host;
  if (!/test/i.test(dbName)) throw new Error(`Refusing to run DB tests: database "${dbName}" does not look like a test database.`);
  if (sameServer && mainName === dbName) throw new Error("Refusing to run DB tests: TEST_DATABASE_URL points at the working database.");
  return url;
}
