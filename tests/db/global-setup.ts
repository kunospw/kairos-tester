import "dotenv/config";
import { execSync } from "node:child_process";
import { assertDisposableTestDb } from "./guard";

// Applies committed migrations to the disposable test database before the DB tests run.
export default function setup() {
  const url = assertDisposableTestDb();
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
  });
}
