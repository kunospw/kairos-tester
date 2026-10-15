import { redirect } from "next/navigation";
import { authConfigured, getSession } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  let signedIn = false;
  let dbError = false;
  try {
    signedIn = Boolean(await getSession());
  } catch {
    dbError = true;
  }
  if (signedIn) redirect("/");
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-navy-50 to-slate-100 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-700">Kairos Business Solutions</p>
          <h1 className="mt-1 text-2xl font-semibold text-navy-900">Kairos Tester</h1>
          <p className="mt-1 text-sm text-slate-500">QA and UAT test management</p>
        </div>
        <div className="card p-6">
          <LoginForm configured={authConfigured()} dbError={dbError} />
        </div>
      </div>
    </main>
  );
}
