"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Button, Input, Spinner } from "@/components/ui";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export default function SetupForm() {
  const router = useRouter();
  const [role, setRole] = useState("");
  const [company, setCompany] = useState("");
  const [companyUrl, setCompanyUrl] = useState("");
  const [jdText, setJdText] = useState("");
  const [resumeText, setResumeText] = useState("");
  const [resumeLabel, setResumeLabel] = useState("");
  const [jdLabel, setJdLabel] = useState("");
  const [uploading, setUploading] = useState<"resume" | "jd" | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  async function uploadFile(file: File, endpoint: "resume" | "jd") {
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("File is too large. Please upload a file smaller than 10 MB.");
      return;
    }
    setUploading(endpoint);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await fetch(`/api/upload/${endpoint}`, { method: "POST", body: form });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      if (endpoint === "resume") { setResumeText(d.text); setResumeLabel(`${file.name} (${(d.chars/1000).toFixed(1)}k chars)`); }
      else { setJdText(d.text); setJdLabel(`${file.name} uploaded`); }
    } catch (e: any) { setError(e.message); }
    finally { setUploading(null); }
  }

  async function start() {
    if (!role.trim()) { setError("Enter the role you're interviewing for."); return; }
    setStarting(true); setError("");
    try {
      const r = await fetch("/api/session/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: role.trim(), company: company.trim(), companyUrl: companyUrl.trim(), jdText, resumeText }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      router.push(`/interview/${d.sessionId}`);
    } catch (e: any) { setError(e.message); setStarting(false); }
  }

  const DropZone = ({ endpoint, label, value }: { endpoint: "resume" | "jd"; label: string; value: string }) => (
    <div
      className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors
        ${value ? "border-success/40 bg-success-dim/40" : "border-border hover:border-accent/50"}`}
      onClick={() => document.getElementById(`file-${endpoint}`)?.click()}
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) uploadFile(f, endpoint); }}
    >
      <input id={`file-${endpoint}`} type="file" className="hidden" accept=".pdf,.docx,.txt"
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f, endpoint); }} />
      {uploading === endpoint ? (
        <div className="flex items-center justify-center gap-2 text-muted text-sm"><Spinner size={14} />Extracting…</div>
      ) : value ? (
        <div className="text-success text-sm">✓ {endpoint === "resume" ? resumeLabel : jdLabel}</div>
      ) : (
        <div className="text-dim text-sm">Drop {label} here or click</div>
      )}
    </div>
  );

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold mb-1">New Interview</h1>
        <p className="text-muted text-sm">The AI adapts every question to your resume and the job description.</p>
      </div>

      <Card>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="Role *" value={role} onChange={setRole} placeholder="Software Engineer" />
            <Input label="Company" value={company} onChange={setCompany} placeholder="Google" />
          </div>
          <Input label="Company website (optional)" value={companyUrl} onChange={setCompanyUrl} placeholder="https://company.com" />

          <div>
            <label className="text-xs font-semibold text-muted uppercase tracking-wide block mb-1.5">
              Resume <span className="text-dim font-normal">(PDF / DOCX / TXT)</span>
            </label>
            <DropZone endpoint="resume" label="your resume" value={resumeText} />
          </div>

          <div>
            <label className="text-xs font-semibold text-muted uppercase tracking-wide block mb-1.5">
              Job Description <span className="text-dim font-normal">(optional — makes questions far more specific)</span>
            </label>
            <DropZone endpoint="jd" label="job description" value={jdLabel} />
            <div className="mt-2">
              <textarea
                value={jdText}
                onChange={e => setJdText(e.target.value)}
                placeholder="…or paste the JD text here"
                rows={4}
                className="w-full bg-surface border border-border rounded-xl px-3 py-2.5 text-sm text-ink placeholder:text-dim focus:outline-none focus:border-accent font-mono"
              />
            </div>
          </div>

          {error && <div className="text-danger text-sm bg-danger-dim border border-danger/30 rounded-xl px-3 py-2">{error}</div>}

          <Button onClick={start} disabled={starting || !role.trim()} size="lg" className="w-full">
            {starting ? <><Spinner size={16} />Starting…</> : "Start Interview →"}
          </Button>

          <p className="text-center text-xs text-dim">
            6 adaptive questions · Groq Llama + Whisper
          </p>
        </div>
      </Card>
    </div>
  );
}
