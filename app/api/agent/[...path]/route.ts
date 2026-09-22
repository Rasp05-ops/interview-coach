import { NextRequest, NextResponse } from "next/server";

// Thin proxy to the Python agent service so the browser never needs CORS or the service URL.
const BASE = () => (process.env.AGENT_SERVICE_URL || "http://127.0.0.1:8001").replace(/\/$/, "");
const ALLOWED = /^(health|sessions(\/[A-Za-z0-9]+(\/(answer|report|patience|blackboard|trace))?)?)$/;

async function proxy(req: NextRequest, path: string[]) {
  const target = path.join("/");
  if (!ALLOWED.test(target)) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    const res = await fetch(`${BASE()}/${target}`, {
      method: req.method,
      headers: { "content-type": "application/json" },
      body: req.method === "GET" ? undefined : await req.text(),
      cache: "no-store",
      signal: AbortSignal.timeout(120_000),
    });
    return new NextResponse(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
  } catch (e) {
    return NextResponse.json({ error: `agent service unreachable at ${BASE()}: ${(e as Error).message}` }, { status: 502 });
  }
}

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) { return proxy(req, params.path); }
export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) { return proxy(req, params.path); }
