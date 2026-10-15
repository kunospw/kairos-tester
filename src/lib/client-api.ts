// Small fetch wrapper for client components. Errors carry the server's message
// and any detail list so forms can show them without losing user input.

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown,
    public code?: string,
  ) {
    super(message);
  }
}

export async function apiFetch<T = unknown>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: json !== undefined ? { "Content-Type": "application/json", ...(rest.headers ?? {}) } : rest.headers,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new ApiError("Could not reach the Kairos Tester server. Is it still running?", 0);
  }
  if (res.status === 401) {
    if (typeof window !== "undefined") window.location.href = "/login";
    throw new ApiError("Your session has ended. Please sign in again.", 401);
  }
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; details?: unknown; code?: string };
    throw new ApiError(b.error || `Request failed (HTTP ${res.status}).`, res.status, b.details, b.code);
  }
  return body as T;
}

export function errorDetails(e: unknown): string[] {
  if (e instanceof ApiError && Array.isArray(e.details)) return e.details.map(String);
  return [];
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
