export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3 py-16 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" aria-hidden="true" />
      Loading…
    </div>
  );
}
