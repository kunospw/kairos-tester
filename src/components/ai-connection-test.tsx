"use client";
import { useState } from "react";
import { apiFetch } from "@/lib/client-api";
import { Alert } from "@/components/ui";
import { FormError } from "@/components/form-error";

interface Result {
  ok: boolean;
  error?: string;
  code?: string;
  model?: string;
  configuredModel?: string;
  latencyMs?: number;
  structuredOutputOk?: boolean;
}

export function AiConnectionTest({ enabled }: { enabled: boolean }) {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2">
      <button
        className="btn-secondary"
        disabled={!enabled || busy}
        onClick={async () => {
          setBusy(true);
          setResult(null);
          setError(null);
          try {
            setResult(await apiFetch<Result>("/api/ai/test-connection", { method: "POST" }));
          } catch (e) {
            setError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Testing…" : "Test connection"}
      </button>
      <FormError error={error} />
      {result &&
        (result.ok ? (
          <Alert kind={result.structuredOutputOk ? "success" : "warning"} title="Provider responded.">
            Model reported: {result.model} (configured {result.configuredModel}) · {result.latencyMs} ms ·{" "}
            {result.structuredOutputOk ? "structured JSON reply OK" : "the reply was not the expected JSON; AI actions may fail validation"}
          </Alert>
        ) : (
          <Alert kind="error" title={`Connection failed (${result.code})`}>{result.error}</Alert>
        ))}
    </div>
  );
}
