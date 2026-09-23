import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { q, isPersistentDbConfigured } from "@/lib/db";
import { fetchCompanyContext } from "@/lib/ai/company";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  const { user } = auth;
  try {
    if ((process.env.VERCEL || process.env.RENDER || process.env.RAILWAY_ENVIRONMENT) && !isPersistentDbConfigured()) {
      return NextResponse.json({
        error: "Production session storage is not configured. Set DATABASE_URL or DB_PATH before creating interviews.",
      }, { status: 503 });
    }
    const { role, company, companyUrl = "", jdText = "", resumeText = "" } = await req.json();
    if (!role?.trim()) return NextResponse.json({ error: "role required" }, { status: 400 });
    const companyContext = companyUrl.trim() ? await fetchCompanyContext(companyUrl) : "";
    const id = uuid();
    await q.session.create.run({ id, owner_user_id: user.id, role: role.trim(), company: (company || "").trim(), company_url: companyUrl.trim(), company_context: companyContext, jd_text: jdText, resume_text: resumeText });
    return NextResponse.json({ sessionId: id });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
