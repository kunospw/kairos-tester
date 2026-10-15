import { NextResponse, type NextRequest } from "next/server";

// Cheap redirect for signed-out page requests. This only checks that a cookie
// exists; every page and API route still verifies the session server-side.
export function proxy(req: NextRequest) {
  const hasCookie = Boolean(req.cookies.get("kt_session")?.value);
  if (!hasCookie) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Pages only: API routes return 401 JSON themselves.
  matcher: ["/((?!api|login|_next/static|_next/image|favicon.ico).*)"],
};
