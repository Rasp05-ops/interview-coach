import { NextRequest, NextResponse } from "next/server";
import { q } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  const { user } = auth;
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const session = await q.session.get.get(id, user.id);
    if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });
    const turns = await q.turn.bySession.all(id, user.id);
    return NextResponse.json({ session, turns });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
