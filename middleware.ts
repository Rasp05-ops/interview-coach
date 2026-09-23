import { NextRequest, NextResponse } from "next/server";
export function middleware(req: NextRequest) {
  const authenticated = Boolean(req.cookies.get("ic_auth")?.value);
  const isAuthPage = req.nextUrl.pathname === "/login" || req.nextUrl.pathname === "/register";
  if (!authenticated && !isAuthPage) return NextResponse.redirect(new URL("/login", req.url));
  if (authenticated && isAuthPage) return NextResponse.redirect(new URL("/", req.url));
  return NextResponse.next();
}
export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"] };
