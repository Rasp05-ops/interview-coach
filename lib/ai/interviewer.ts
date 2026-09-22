import { getGroq, MODELS } from "@/lib/ai/client";
import { buildContext } from "@/lib/rag/context";

// Long spoken answers (~2 min) run to ~2000 chars; never cut off the Result at the end of a STAR story.
const MAX_ANSWER_CHARS = 4000;
const SUMMARY_ANSWER_CHARS = 400;

const QTYPES = ["motivational", "behavioral", "situational", "technical"] as const;
type QType = typeof QTYPES[number];

export async function classifyConversationalTurn(text: string, interviewQuestion: string): Promise<{
  isInterviewAnswer: boolean;
  response: string;
}> {
  const prompt = `Classify this candidate utterance during an interview.
Interview question: "${interviewQuestion.slice(0, 800)}"
Candidate utterance: "${text.slice(0, 800)}"

An interview answer gives evidence, experience, reasoning, or a direct response to the interview question.
A conversational turn asks for clarification, changes the wording/topic of the question, checks what the interviewer means, or asks a general question instead of answering.
Respond ONLY as JSON: {"isInterviewAnswer":true|false,"response":"brief helpful response if false, otherwise empty"}`;
  try {
    const res = await getGroq().chat.completions.create({
      model: MODELS.fast,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      response_format: { type: "json_object" },
    });
    const data = JSON.parse(res.choices[0].message.content || "{}");
    return {
      isInterviewAnswer: data.isInterviewAnswer !== false,
      response: typeof data.response === "string" ? data.response : "Please answer the interview question when you are ready.",
    };
  } catch {
    return { isInterviewAnswer: true, response: "" };
  }
}

// ── Question generation ──────────────────────────────────────────────────────

export async function generateFirstQuestion(opts: {
  role: string; company: string; companyContext?: string; jdText: string; resumeText: string;
}): Promise<{ question: string; type: QType }> {
  const ctx = buildContext({ ...opts, qType: "motivational", history: [] });
  const sys = `You are a senior interviewer at ${opts.company || "a tech company"} for a ${opts.role} position.
You ask ONE specific, grounded question at a time. Always reference the candidate's resume or JD when possible.`;
  const user = `${ctx}\n\nOpen the interview with a warm but probing motivational/fit question.
Reference something specific from their background or the role.\nRespond ONLY as JSON: {"question":"...","type":"motivational"}`;

  const res = await getGroq().chat.completions.create({
    model: MODELS.chat, messages: [{ role: "system", content: sys }, { role: "user", content: user }],
    temperature: 0.7, response_format: { type: "json_object" },
  });
  const d = JSON.parse(res.choices[0].message.content || "{}");
  return { question: d.question || "Tell me about yourself and why you're interested in this role.", type: "motivational" };
}

export async function generateNextQuestion(opts: {
  role: string; company: string; companyContext?: string; jdText: string; resumeText: string;
  history: { q: string; a: string; score: number; type: string }[];
  turnIndex: number; total?: number;
}): Promise<{ question: string; type: QType } | null> {
  if (opts.total !== undefined && opts.turnIndex >= opts.total) return null;

  const scores = opts.history.map(h => h.score);
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 5;
  const usedTypes = opts.history.map(h => h.type);

  // Adaptive: revisit weak type, else pick least-used
  const weakType = [...opts.history].filter(h => h.score < 5).sort((a, b) => a.score - b.score)[0]?.type;
  const counts: Record<string, number> = {};
  for (const t of QTYPES) counts[t] = usedTypes.filter(u => u === t).length;
  const leastUsed = QTYPES.filter(t => counts[t] < 2).sort((a, b) => counts[a] - counts[b])[0] || "behavioral";
  const targetType: QType = (weakType && Math.random() > 0.4 ? weakType : leastUsed) as QType;

  const ctx = buildContext({ role: opts.role, company: opts.company, companyContext: opts.companyContext, jdText: opts.jdText, resumeText: opts.resumeText, qType: targetType, history: opts.history.map(h => ({ q: h.q, a: h.a })) });
  const difficulty = avg >= 7 ? "Push harder — ask a more challenging question." : avg < 4.5 ? "Ask a somewhat easier question to help them recover." : "";

  const sys = `You are a senior interviewer. ${difficulty} Do NOT repeat questions asked before.`;
  const user = `${ctx}\n\nAsk a ${targetType} question (question ${opts.turnIndex + 1} in this timed session).
Be specific to their resume / the JD. No generic openers.\nJSON only: {"question":"...","type":"${targetType}"}`;

  const res = await getGroq().chat.completions.create({
    model: MODELS.chat, messages: [{ role: "system", content: sys }, { role: "user", content: user }],
    temperature: 0.8, response_format: { type: "json_object" },
  });
  const d = JSON.parse(res.choices[0].message.content || "{}");
  return { question: d.question || "Walk me through a challenge you faced recently.", type: d.type || targetType };
}

// ── STAR structure detector ─────────────────────────────────────────────────

export async function detectSTAR(answer: string): Promise<{
  situation: boolean; task: boolean; action: boolean; result: boolean; score: number;
}> {
  if (!answer || answer.length < 40) return { situation: false, task: false, action: false, result: false, score: 0 };

  const prompt = `Does this interview answer contain each STAR element?
Answer: "${answer.slice(0, MAX_ANSWER_CHARS)}"
Respond ONLY as JSON: {"situation":bool,"task":bool,"action":bool,"result":bool}`;

  const res = await getGroq().chat.completions.create({
    model: MODELS.fast, messages: [{ role: "user", content: prompt }],
    temperature: 0, response_format: { type: "json_object" },
  });
  const d = JSON.parse(res.choices[0].message.content || "{}");
  const parts = [d.situation, d.task, d.action, d.result].filter(Boolean).length;
  return { situation: !!d.situation, task: !!d.task, action: !!d.action, result: !!d.result, score: parts * 25 };
}

// ── Answer evaluation ────────────────────────────────────────────────────────

export async function evaluateAnswer(opts: {
  role: string; company: string; companyContext?: string; question: string; questionType: string;
  answer: string; jdText: string; resumeText: string;
  fillerCount: number; audioSeconds: number; wpm: number;
  star: { situation: boolean; task: boolean; action: boolean; result: boolean; score: number };
}): Promise<{ score: number; feedback: string; strengths: string[]; improvements: string[] }> {
  const { role, company, question, questionType, answer, fillerCount, audioSeconds, wpm, star } = opts;

  if (!answer || answer.length < 15) {
    return { score: 1, feedback: "No answer was recorded. Please try again and speak clearly.", strengths: [], improvements: ["Provide a complete answer", "Use the STAR method", "Aim for 45–90 seconds"] };
  }

  const ctx = buildContext({ role, company, companyContext: opts.companyContext, jdText: opts.jdText, resumeText: opts.resumeText, qType: questionType, history: [{ q: question, a: answer }] });
  const starNote = questionType === "behavioral" ? `STAR coverage: S=${star.situation} T=${star.task} A=${star.action} R=${star.result}` : "";

  const prompt = `You're evaluating a ${role} interview answer at ${company || "a company"}.

Question (${questionType}): "${question}"
Answer: "${answer.slice(0, MAX_ANSWER_CHARS)}"
Delivery: ${audioSeconds.toFixed(0)}s, ${wpm} wpm, ${fillerCount} filler words. ${starNote}

${ctx}

Score 1-10. Penalise: vague/generic answers, no examples, many fillers (>5), very short (<20s) or very long (>180s), missing STAR for behavioral.
Reward: concrete examples, specific numbers/outcomes, references to their actual background, clear structure.

JSON only: {"score":N,"feedback":"2-3 sentences direct feedback","strengths":["...","..."],"improvements":["...","...","..."]}`;

  const res = await getGroq().chat.completions.create({
    model: MODELS.fast, messages: [{ role: "user", content: prompt }],
    temperature: 0.3, response_format: { type: "json_object" },
  });
  const d = JSON.parse(res.choices[0].message.content || "{}");
  return {
    score: Math.max(1, Math.min(10, Number(d.score) || 5)),
    feedback: d.feedback || "Answer received.",
    strengths: Array.isArray(d.strengths) ? d.strengths : [],
    improvements: Array.isArray(d.improvements) ? d.improvements : [],
  };
}

// ── Session summary ──────────────────────────────────────────────────────────

export async function generateSummary(opts: {
  role: string; company: string; companyContext?: string;
  turns: { question: string; answer: string; score: number; type: string; feedback: string }[];
}): Promise<{ overallScore: number; verdict: string; strengths: string[]; gaps: string[]; studyPlan: string[] }> {
  const avg = opts.turns.reduce((s, t) => s + t.score, 0) / opts.turns.length;
  const qa = opts.turns.map((t, i) => `Q${i + 1}[${t.type} ${t.score}/10]: ${t.question}\nA: ${t.answer.slice(0, SUMMARY_ANSWER_CHARS)}${t.answer.length > SUMMARY_ANSWER_CHARS ? "..." : ""}`).join("\n\n");

  const prompt = `Complete interview review for ${opts.role} at ${opts.company || "a company"}. Avg score: ${avg.toFixed(1)}/10.

Company research (use only as context, do not invent facts):
${opts.companyContext || "No company research provided."}

${qa}

JSON only: {
  "overallScore": <1-10>,
  "verdict": "<Strong Hire | Hire | Maybe | No Hire>",
  "strengths": ["...","...","..."],
  "gaps": ["...","...","..."],
  "studyPlan": ["...","...","...","..."]
}`;

  const res = await getGroq().chat.completions.create({
    model: MODELS.chat, messages: [{ role: "user", content: prompt }],
    temperature: 0.4, response_format: { type: "json_object" },
  });
  const d = JSON.parse(res.choices[0].message.content || "{}");
  return {
    overallScore: Number(d.overallScore) || avg,
    verdict: d.verdict || "Interview complete.",
    strengths: Array.isArray(d.strengths) ? d.strengths : [],
    gaps: Array.isArray(d.gaps) ? d.gaps : [],
    studyPlan: Array.isArray(d.studyPlan) ? d.studyPlan : [],
  };
}
