import { NextResponse } from "next/server";
import { q } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const sessions = (await q.session.list.all()) as any[];
    return NextResponse.json({
      sessions: await Promise.all(sessions.map(async (s) => {
        const count = await q.turn.count.get(s.id) as any;
        return { ...s, turn_count: Number((count && count.n) ?? 0) };
      })),
    });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
