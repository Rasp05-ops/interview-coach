import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { q, isPersistentDbConfigured } from "@/lib/db";
import { transcribeBuffer, analyzeDelivery, isMicrophoneCheck, looksLikeConversationalQuestion } from "@/lib/ai/transcribe";
import { evaluateAnswer, generateNextQuestion, detectSTAR, classifyConversationalTurn } from "@/lib/ai/interviewer";
import { detectEOT, resolveDuration } from "@/lib/audio/eot";
import { SESSION_DURATION_SECONDS } from "@/lib/interview/config";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  const { user } = auth;
  if ((process.env.VERCEL || process.env.RENDER || process.env.RAILWAY_ENVIRONMENT) && !isPersistentDbConfigured()) {
    return NextResponse.json({
      error: "This deployment is missing a persistent database. The interview cannot continue without shared session storage.",
      code: "DB_NOT_CONFIGURED",
    }, { status: 503 });
  }
  const form = await req.formData();
  const audio = form.get("audio") as File | null;
  const sessionId = form.get("sessionId") as string;
  const turnId = form.get("turnId") as string;
  const clientSeconds = Number(form.get("clientSeconds")) || 0;

  if (!audio || !sessionId || !turnId)
    return NextResponse.json({ error: "audio, sessionId, turnId required" }, { status: 400 });

  const session = await q.session.get.get(sessionId, user.id) as any;
  const turn = await q.turn.get.get(turnId, user.id) as any;
  if (!session || !turn || turn.session_id !== sessionId)
    return NextResponse.json({ error: "not found" }, { status: 404 });
  if (turn.answer_text)
    return NextResponse.json({ error: "turn already answered" }, { status: 409 });

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "ic-"));
  const audioPath = path.join(tmpDir, "answer.webm");

  try {
    const buf = Buffer.from(await audio.arrayBuffer());
    await writeFile(audioPath, buf);

    const [eot, transcript] = await Promise.all([
      detectEOT(audioPath),
      transcribeBuffer(buf, "answer.webm"),
    ]);

    const audioSeconds = resolveDuration(eot, clientSeconds);
    if (isMicrophoneCheck(transcript.text)) {
      return NextResponse.json({
        error: "I can hear you. This check was not counted. Please answer the interview question, then stop recording when you finish.",
        code: "MIC_CHECK",
        transcript: transcript.text,
      }, { status: 422 });
    }
    if (looksLikeConversationalQuestion(transcript.text)) {
      const conversational = await classifyConversationalTurn(transcript.text, turn.question);
      if (!conversational.isInterviewAnswer) {
        return NextResponse.json({
          error: conversational.response,
          code: "CONVERSATIONAL_TURN",
          transcript: transcript.text,
        }, { status: 422 });
      }
    }
    const delivery = analyzeDelivery(transcript.text, audioSeconds, transcript.words);
    const star = await detectSTAR(transcript.text);

    const evaluation = await evaluateAnswer({
      role: session.role, company: session.company,
      companyContext: session.company_context,
      question: turn.question, questionType: turn.question_type,
      answer: transcript.text, jdText: session.jd_text, resumeText: session.resume_text,
      fillerCount: delivery.fillerCount, audioSeconds, wpm: delivery.wpm, star,
    });

    await q.turn.update.run({
      id: turnId, owner_user_id: user.id,
      answer_text: transcript.text,
      answer_audio_s: audioSeconds,
      filler_count: delivery.fillerCount,
      filler_words: JSON.stringify(delivery.fillerWords),
      wpm: delivery.wpm,
      score: evaluation.score,
      feedback: evaluation.feedback,
      strengths: JSON.stringify(evaluation.strengths),
      improvements: JSON.stringify(evaluation.improvements),
      star_breakdown: JSON.stringify(star),
      eot_probability: eot.probability,
    });

    const allTurns = await q.turn.bySession.all(sessionId, user.id) as any[];
    const nextIdx = turn.turn_index + 1;
    const elapsedSeconds = Math.max(0, (Date.now() - Date.parse(`${session.created_at}Z`)) / 1000);
    const isDone = elapsedSeconds >= SESSION_DURATION_SECONDS;

    let nextTurnId: string | null = null;
    let nextQuestion: string | null = null;
    let nextQType: string | null = null;

    if (!isDone) {
      const history = allTurns.filter((t: any) => t.answer_text).map((t: any) => ({
        q: t.question, a: t.answer_text, score: t.score || 5, type: t.question_type,
      }));
      const next = await generateNextQuestion({
        role: session.role, company: session.company,
        companyContext: session.company_context,
        jdText: session.jd_text, resumeText: session.resume_text,
        history, turnIndex: nextIdx,
      });
      if (next) {
        nextTurnId = uuid();
        nextQuestion = next.question;
        nextQType = next.type;
        await q.turn.create.run({ id: nextTurnId, session_id: sessionId, owner_user_id: user.id, turn_index: nextIdx, question: nextQuestion, question_type: nextQType });
      }
    }

    return NextResponse.json({
      transcript: transcript.text, fillerCount: delivery.fillerCount, fillerWords: delivery.fillerWords,
      wpm: delivery.wpm, audioSeconds, eotProbability: eot.probability,
      delivery: {
        hedgeCount: delivery.hedgeCount, pauseCount: delivery.pauseCount,
        longPauseCount: delivery.longPauseCount, longestPauseS: delivery.longestPauseS,
        articulationWpm: delivery.articulationWpm, firstWordDelayS: delivery.firstWordDelayS,
      },
      score: evaluation.score, feedback: evaluation.feedback,
      strengths: evaluation.strengths, improvements: evaluation.improvements,
      star,
      nextTurnId, nextQuestion, nextQType, nextTurnIndex: isDone ? null : nextIdx,
      isComplete: isDone, remainingSeconds: Math.max(0, Math.floor(SESSION_DURATION_SECONDS - elapsedSeconds)),
    });
  } catch (e: any) {
    console.error("/api/interview/answer", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}
