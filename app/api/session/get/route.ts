import { NextRequest, NextResponse } from "next/server";
import db, { q } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const session = q.session.get.get(id);
    if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });
    const turns = q.turn.bySession.all(id);
    return NextResponse.json({ session, turns });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
