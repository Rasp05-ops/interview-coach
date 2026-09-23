import { NextRequest, NextResponse } from "next/server";
import { extractText } from "@/lib/ai/extract";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 20;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const auth = requireUser(req);
  if ("response" in auth) return auth.response;
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "no file" }, { status: 400 });
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "File is too large. Please upload a file smaller than 10 MB." }, { status: 413 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const text = await extractText(buf, file.name);
    if (text.length < 30) return NextResponse.json({ error: "Could not extract text." }, { status: 400 });
    return NextResponse.json({ text, filename: file.name, chars: text.length });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }); }
}
