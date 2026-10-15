"use client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const db = /database|ECONNREFUSED|DATABASE_URL|reach database/i.test(error.message);
  return (
    <div role="alert" className="card mx-auto mt-10 max-w-xl p-6">
      <h1 className="text-lg font-semibold text-red-800">{db ? "The database is not reachable" : "Something went wrong"}</h1>
      <p className="mt-2 text-sm text-slate-600">
        {db
          ? "Check that PostgreSQL is running and DATABASE_URL in .env is correct, then try again."
          : "The page could not be displayed. Your saved data is unaffected. Try again, and check the server console for details."}
      </p>
      {error.digest && <p className="mt-2 text-xs text-slate-400">Reference: {error.digest}</p>}
      <button className="btn-primary mt-4" onClick={reset}>Try again</button>
    </div>
  );
}
