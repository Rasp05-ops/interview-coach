import { NextRequest, NextResponse } from "next/server";
import { assertAuthConfigured, authenticateUser, setAuthCookie } from "@/lib/auth";
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  try {
    assertAuthConfigured();
    const { email = "", password = "" } = await req.json();
    if (typeof email !== "string" || typeof password !== "string") return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    const user = await authenticateUser(email, password);
    if (!user) return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
    const res = NextResponse.json({ user });
    setAuthCookie(res, user);
    return res;
  } catch (e: any) { return NextResponse.json({ error: e.message || "Unable to sign in." }, { status: 500 }); }
}
