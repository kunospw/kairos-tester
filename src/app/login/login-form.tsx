"use client";
import { useState } from "react";
import { Alert } from "@/components/ui";
import { FormError } from "@/components/form-error";
import { apiFetch } from "@/lib/client-api";

export function LoginForm({ configured, dbError }: { configured: boolean; dbError: boolean }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/api/auth/login", { method: "POST", json: { username, password } });
      window.location.href = "/";
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  if (!configured) {
    return (
      <Alert kind="warning" title="No tester account configured">
        Set <code>TESTER_USERNAME</code> and <code>TESTER_PASSWORD_HASH</code> in <code>.env</code> (generate the hash with{" "}
        <code>npm run hash-password</code>), then restart the app.
      </Alert>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      {dbError && (
        <Alert kind="error" title="Database unavailable">
          Check DATABASE_URL and that PostgreSQL is running.
        </Alert>
      )}
      <FormError error={error} />
      <div>
        <label className="label" htmlFor="username">Username</label>
        <input id="username" className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
      </div>
      <div>
        <label className="label" htmlFor="password">Password</label>
        <input
          id="password"
          type="password"
          className="input"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      <button type="submit" className="btn-primary btn-lg w-full" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
