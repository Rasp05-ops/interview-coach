import { NextRequest, NextResponse } from "next/server";
import { extractText } from "@/lib/ai/extract";

export const runtime = "nodejs";
export const maxDuration = 20;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const rawText = form.get("text") as string | null;

    if (rawText && rawText.trim().length > 20) {
      return NextResponse.json({ text: rawText.trim(), filename: "pasted.txt", chars: rawText.length });
    }
    if (!file) return NextResponse.json({ error: "provide file or text" }, { status: 400 });
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "File is too large. Please upload a file smaller than 10 MB." }, { status: 413 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const text = await extractText(buf, file.name);
    return NextResponse.json({ text, filename: file.name, chars: text.length });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }); }
}
