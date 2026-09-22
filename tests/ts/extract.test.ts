import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { extractText } from "@/lib/ai/extract";

const fx = (n: string) => fs.readFileSync(path.join(__dirname, "..", "fixtures", n));

describe("resume / JD text extraction", () => {
  // Regression: pdf-parse 1.1.4 failed two of these three with "bad XRef entry".
  it.each(["resume_reportlab.pdf", "resume_fpdf.pdf", "resume_pypdf.pdf"])("reads text PDFs from different generators: %s", async (name) => {
    const t = await extractText(fx(name), name);
    expect(t).toContain("EXPERIENCE");
    expect(t).toContain("Kafka ingestion pipeline");
  });

  it("keeps section headings on their own lines (the agent's chunker relies on this)", async () => {
    const lines = (await extractText(fx("resume_reportlab.pdf"), "r.pdf")).split("\n").map(l => l.trim());
    expect(lines).toEqual(expect.arrayContaining(["EXPERIENCE", "PROJECTS", "SKILLS"]));
  });

  it("returns empty text for an image-only PDF (the route turns this into a clear error)", async () => {
    expect(await extractText(fx("no_text.pdf"), "scan.pdf")).toBe("");
  });

  it("reads DOCX", async () => {
    const t = await extractText(fx("resume.docx"), "resume.docx");
    expect(t).toContain("EXPERIENCE");
    expect(t).toContain("Kafka ingestion pipeline");
  });

  it("reads TXT and trims", async () => {
    expect(await extractText(Buffer.from("  hello resume \n"), "r.txt")).toBe("hello resume");
  });

  it("gives a friendly error for a corrupted PDF and for unsupported types", async () => {
    await expect(extractText(Buffer.from("this is not a pdf at all"), "bad.pdf")).rejects.toThrow(/Could not read this PDF/);
    await expect(extractText(Buffer.from("x"), "r.png")).rejects.toThrow(/Unsupported: \.png/);
  });
});
