import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto mt-16 max-w-md px-4 text-center">
      <h1 className="text-xl font-semibold text-ink-900">Not found</h1>
      <p className="mt-2 text-sm text-slate-600">That page or record does not exist, or belongs to a different application.</p>
      <Link className="btn-primary mt-4" href="/">Back to applications</Link>
    </main>
  );
}
