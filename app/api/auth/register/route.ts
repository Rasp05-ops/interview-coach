import { NextRequest, NextResponse } from "next/server";
import { assertAuthConfigured, registerUser, setAuthCookie } from "@/lib/auth";

export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  try {
    assertAuthConfigured();
    const { email = "", password = "" } = await req.json();
    if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    if (typeof password !== "string" || password.length < 10 || password.length > 200) return NextResponse.json({ error: "Password must be between 10 and 200 characters." }, { status: 400 });
    const user = await registerUser(email, password);
    const res = NextResponse.json({ user });
    setAuthCookie(res, user);
    return res;
  } catch (e: any) {
    if (e?.code === "23505" || e?.code === "SQLITE_CONSTRAINT_UNIQUE") return NextResponse.json({ error: "An account with that email already exists." }, { status: 409 });
    return NextResponse.json({ error: e.message || "Unable to create account." }, { status: 500 });
  }
}
