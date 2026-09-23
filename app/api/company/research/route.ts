import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { fetchCompanyContext } from "@/lib/ai/company";

export const runtime = "nodejs";
export const maxDuration = 12;

export async function POST(req: NextRequest) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  try {
    const { url = "" } = await req.json();
    if (!url.trim()) return NextResponse.json({ context: "" });
    const context = await fetchCompanyContext(url);
    if (!context) return NextResponse.json({ error: "No readable text was found on that company page." }, { status: 422 });
    return NextResponse.json({ context });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Could not research company website." }, { status: 400 });
  }
}
