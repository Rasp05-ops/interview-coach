function chunk(text: string, size = 350, overlap = 70): string[] {
  if (!text?.trim()) return [];
  const words = text.split(/\s+/);
  const out: string[] = [];
  for (let i = 0; i < words.length; i += size - overlap)
    out.push(words.slice(i, i + size).join(" "));
  return out.filter(c => c.length > 40);
}

function score(chunk: string, query: string): number {
  const terms = query.toLowerCase().split(/\W+/).filter(t => t.length > 3);
  const cl = chunk.toLowerCase();
  return terms.reduce((s, t) => s + (cl.match(new RegExp(t, "g")) || []).length, 0);
}

function top(text: string, query: string, k = 3): string[] {
  return chunk(text)
    .map(c => ({ c, s: score(c, query) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map(x => x.c);
}

export function buildContext(opts: {
  role: string; company: string; companyContext?: string; jdText: string; resumeText: string;
  qType: string; history: { q: string; a: string }[];
}): string {
  const query = `${opts.role} ${opts.company} ${opts.qType} experience skills`;
  const parts: string[] = [];
  const jd = top(opts.jdText, query, 3);
  const cv = top(opts.resumeText, query, 4);
  if (jd.length) parts.push(`### Job Description\n${jd.join("\n\n")}`);
  if (cv.length) parts.push(`### Candidate Resume\n${cv.join("\n\n")}`);
  if (opts.companyContext?.trim()) parts.push(`### Company Research\n${opts.companyContext.trim()}`);
  if (opts.history.length) {
    const recent = opts.history.slice(-3).map(h => `Q: ${h.q}\nA: ${h.a}`).join("\n\n");
    parts.push(`### Prior conversation\n${recent}`);
  }
  return parts.join("\n\n---\n\n");
}
