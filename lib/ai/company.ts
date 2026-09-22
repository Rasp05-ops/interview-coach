const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_CONTEXT_CHARS = 8_000;

function isPublicHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host.endsWith(".local")) return null;
    if (/^(10|127)\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return null;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return null;
    return url;
  } catch {
    return null;
  }
}

function cleanHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CONTEXT_CHARS);
}

export async function fetchCompanyContext(companyUrl: string): Promise<string> {
  if (!companyUrl.trim()) return "";
  const url = isPublicHttpUrl(companyUrl.trim());
  if (!url) throw new Error("Company website must be a public http(s) URL.");

  const response = await fetch(url, {
    headers: { "user-agent": "InterviewCoach/1.0 (company research)" },
    signal: AbortSignal.timeout(8_000),
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`Company website returned HTTP ${response.status}.`);

  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_RESPONSE_BYTES) {
    const part = await reader.read();
    if (part.done) break;
    chunks.push(part.value);
    size += part.value.byteLength;
  }
  await reader.cancel();
  return cleanHtml(Buffer.concat(chunks).toString("utf8"));
}
