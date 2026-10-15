import "server-only";
// Server-side Ollama Cloud chat client. The API key is read from the
// environment on each call, never returned to the browser, and never logged.

export type AiErrorCode =
  | "not_configured"
  | "auth"
  | "model_not_found"
  | "rate_limited"
  | "provider_error"
  | "timeout"
  | "network"
  | "malformed";

export class AiError extends Error {
  constructor(
    public code: AiErrorCode,
    message: string,
    public details?: string[],
  ) {
    super(message);
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export function aiConfig() {
  return {
    url: process.env.OLLAMA_CHAT_URL?.trim() || "https://ollama.com/api/chat",
    model: process.env.OLLAMA_MODEL?.trim() || "deepseek-v4-pro:cloud",
    timeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS || 120_000),
    keyConfigured: Boolean(process.env.OLLAMA_API_KEY?.trim()),
  };
}

export interface ChatResult {
  content: string;
  model: string;
  durationMs: number;
}

const MAX_RESPONSE_CHARS = 400_000;

export async function ollamaChat(messages: ChatMessage[], opts: { json?: boolean; timeoutMs?: number } = {}): Promise<ChatResult> {
  const cfg = aiConfig();
  const key = process.env.OLLAMA_API_KEY?.trim();
  if (!key) {
    throw new AiError("not_configured", "AI is not configured. Set OLLAMA_API_KEY in .env and restart the app. Manual features work without AI.");
  }
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(cfg.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        stream: false,
        ...(opts.json ? { format: "json" } : {}),
        options: { temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? cfg.timeoutMs),
    });
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new AiError("timeout", `The AI provider did not respond within ${Math.round((opts.timeoutMs ?? cfg.timeoutMs) / 1000)} s. Your input was kept; try again.`);
    }
    throw new AiError("network", `Could not reach the AI provider at ${new URL(cfg.url).host}. Check your connection.`);
  }

  const text = await res.text();
  if (!res.ok) {
    let providerMsg = "";
    try {
      providerMsg = String(JSON.parse(text)?.error ?? "");
    } catch {
      providerMsg = "";
    }
    providerMsg = providerMsg.replace(/[A-Za-z0-9_\-]{32,}/g, "[redacted]").slice(0, 300);
    if (res.status === 401 || res.status === 403) {
      throw new AiError("auth", `The AI provider rejected the API key (HTTP ${res.status}). Check OLLAMA_API_KEY.`);
    }
    if (res.status === 404) {
      throw new AiError("model_not_found", `Model "${cfg.model}" was not found or is not available to this key (HTTP 404). ${providerMsg}`.trim());
    }
    if (res.status === 429) throw new AiError("rate_limited", "The AI provider rate limit was reached. Wait and try again.");
    throw new AiError("provider_error", `The AI provider returned HTTP ${res.status}. ${providerMsg}`.trim());
  }
  if (text.length > MAX_RESPONSE_CHARS) throw new AiError("malformed", "The AI response was unexpectedly large and was discarded.");

  let body: { model?: string; message?: { content?: string }; error?: string };
  try {
    body = JSON.parse(text);
  } catch {
    throw new AiError("malformed", "The AI provider returned a response that is not JSON.");
  }
  if (body.error) throw new AiError("provider_error", `AI provider error: ${String(body.error).slice(0, 300)}`);
  const content = body.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new AiError("malformed", "The AI provider returned an empty message.");
  }
  return { content, model: body.model || cfg.model, durationMs: Date.now() - started };
}

/** Extract a JSON value from model output (tolerates code fences / think blocks). */
export function extractJson(content: string): unknown {
  let s = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    const start = s.search(/[[{]/);
    const end = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(s.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    throw new AiError("malformed", "The AI response did not contain valid JSON. Nothing was saved; try again.");
  }
}
