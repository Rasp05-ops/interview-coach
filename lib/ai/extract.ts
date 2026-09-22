// Text extraction for uploaded resumes / job descriptions (PDF, DOCX, TXT).
// PDFs use `unpdf` (a current pdf.js build). The previous `pdf-parse` bundles a 2017 pdf.js that failed on
// PDFs from common generators ("bad XRef entry") and behaved differently across Node versions.
export async function extractText(buffer: Buffer, filename: string): Promise<string> {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "pdf") {
    try {
      const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await pdfText(pdf, { mergePages: true });
      return text.trim();
    } catch (e) {
      throw new Error(`Could not read this PDF (${(e as Error).message}). It may be encrypted or corrupted; try re-exporting it, or upload DOCX/TXT.`);
    }
  }
  if (ext === "docx") {
    const mammoth = await import("mammoth");
    return (await mammoth.extractRawText({ buffer })).value.trim();
  }
  if (ext === "txt") return buffer.toString("utf-8").trim();
  throw new Error(`Unsupported: .${ext} — please upload PDF, DOCX, or TXT.`);
}
