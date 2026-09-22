import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import db, { q } from "@/lib/db";
import { fetchCompanyContext } from "@/lib/ai/company";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { role, company, companyUrl = "", jdText = "", resumeText = "" } = await req.json();
    if (!role?.trim()) return NextResponse.json({ error: "role required" }, { status: 400 });
    const companyContext = companyUrl.trim() ? await fetchCompanyContext(companyUrl) : "";
    const id = uuid();
    q.session.create.run({ id, role: role.trim(), company: (company || "").trim(), company_url: companyUrl.trim(), company_context: companyContext, jd_text: jdText, resume_text: resumeText });
    return NextResponse.json({ sessionId: id });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}
