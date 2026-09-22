import { NextRequest, NextResponse } from "next/server";
import db, { q, isPersistentDbConfigured } from "@/lib/db";
import { generateSummary } from "@/lib/ai/interviewer";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    if ((process.env.VERCEL || process.env.RENDER || process.env.RAILWAY_ENVIRONMENT) && !isPersistentDbConfigured()) {
      return NextResponse.json({
        error: "This deployment is missing a persistent database. Session results cannot be saved without shared storage.",
      }, { status: 503 });
    }
    const { sessionId } = await req.json();
    const session = q.session.get.get(sessionId) as any;
    if (!session) return NextResponse.json({ error: "not found" }, { status: 404 });

    const turns = (q.turn.bySession.all(sessionId) as any[]).filter(t => t.answer_text);
    if (!turns.length) return NextResponse.json({ error: "no answers yet" }, { status: 400 });

    const summary = await generateSummary({
      role: session.role, company: session.company,
      companyContext: session.company_context,
      turns: turns.map(t => ({ question: t.question, answer: t.answer_text, score: t.score || 5, type: t.question_type, feedback: t.feedback || "" })),
    });

    const dur = Math.round(turns.reduce((s, t) => s + (t.answer_audio_s || 0), 0));
    q.session.finish.run({ id: sessionId, score: summary.overallScore, dur, verdict: summary.verdict, study_plan: JSON.stringify(summary.studyPlan) });

    return NextResponse.json({
      ...summary,
      session: { role: session.role, company: session.company, duration_s: dur },
      turns: turns.map(t => ({
        turn_index: t.turn_index, question: t.question, question_type: t.question_type,
        answer_text: t.answer_text, score: t.score, feedback: t.feedback,
        strengths: JSON.parse(t.strengths || "[]"),
        improvements: JSON.parse(t.improvements || "[]"),
        star_breakdown: JSON.parse(t.star_breakdown || "{}"),
        filler_count: t.filler_count, wpm: t.wpm, answer_audio_s: t.answer_audio_s,
        eot_probability: t.eot_probability,
      })),
    });
  } catch (e: any) {
    console.error("/api/interview/feedback", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
