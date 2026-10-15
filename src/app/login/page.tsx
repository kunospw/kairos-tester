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
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-ink-900 text-base font-bold text-white" aria-hidden="true">K</span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Kairos Tester</h1>
            <p className="text-sm text-slate-500">Sign in to continue testing</p>
          </div>
        </div>
        <div className="card p-6">
          <LoginForm configured={authConfigured()} dbError={dbError} />
        </div>
      </div>
    </main>
  );
}
