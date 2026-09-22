import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { q, isPersistentDbConfigured } from "@/lib/db";
import { generateFirstQuestion } from "@/lib/ai/interviewer";
import { SESSION_DURATION_SECONDS } from "@/lib/interview/config";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    if ((process.env.VERCEL || process.env.RENDER || process.env.RAILWAY_ENVIRONMENT) && !isPersistentDbConfigured()) {
      return NextResponse.json({
        error: "This production deployment is missing a persistent database. Configure DATABASE_URL or DB_PATH before starting interviews.",
      }, { status: 503 });
    }
    const { sessionId } = await req.json();
    const session = await q.session.get.get(sessionId) as any;
    if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });
    const elapsed = Math.max(0, (Date.now() - Date.parse(`${session.created_at}Z`)) / 1000);
    if (elapsed >= SESSION_DURATION_SECONDS) return NextResponse.json({ error: "This interview session has expired." }, { status: 410 });

    const { question, type } = await generateFirstQuestion({
      role: session.role, company: session.company,
      companyContext: session.company_context,
      jdText: session.jd_text, resumeText: session.resume_text,
    });
    const turnId = uuid();
    await q.turn.create.run({ id: turnId, session_id: sessionId, turn_index: 0, question, question_type: type });
    return NextResponse.json({ turnId, question, questionType: type, turnIndex: 0, remainingSeconds: Math.max(0, Math.floor(SESSION_DURATION_SECONDS - elapsed)) });
  } catch (e: any) {
    console.error("/api/interview/start", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
