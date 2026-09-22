import { NextResponse } from "next/server";
import db, { q } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";   // ← add this line

export async function GET() {
  try {
    const sessions = q.session.list.all() as any[];
    return NextResponse.json({ sessions: sessions.map(s => ({ ...s, turn_count: (q.turn.count.get(s.id) as any)?.n || 0 })) });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
