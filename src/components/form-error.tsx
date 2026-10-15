"use client";
import { Alert } from "@/components/ui";
import { errorDetails, errorMessage } from "@/lib/client-api";

export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  const details = errorDetails(error);
  return (
    <Alert kind="error" title={errorMessage(error)}>
      {details.length > 0 && (
        <ul className="list-disc pl-5">
          {details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
    </Alert>
  );
}
