"use client";

export interface PreparedPreview {
  messages: { role: string; content: string }[];
  submitted: { summary: string; items: string[]; characters: number; model: string; endpointHost: string };
}

/** Shows exactly what will be sent to the AI provider before generation. */
export function AiSubmitPreview({ preview }: { preview: PreparedPreview }) {
  const s = preview.submitted;
  return (
    <div className="rounded border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
      <p className="font-semibold">What will be sent to {s.endpointHost} ({s.model})</p>
      <p className="mt-1">{s.summary}</p>
      <ul className="mt-1 list-disc pl-5 text-xs">
        {s.items.map((i, n) => <li key={n}>{i}</li>)}
      </ul>
      <p className="mt-1 text-xs">
        {s.characters.toLocaleString()} characters in total. Attachments, credentials and other records are not sent. The request is made from the server; your API key never
        reaches the browser.
      </p>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-medium">Show the full prompt</summary>
        {preview.messages.map((m, i) => (
          <div key={i} className="mt-2">
            <p className="text-xs font-semibold uppercase">{m.role}</p>
            <pre className="prewrap max-h-64 overflow-auto rounded bg-white p-2 text-xs text-slate-700">{m.content}</pre>
          </div>
        ))}
      </details>
    </div>
  );
}
