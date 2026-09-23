"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const register = mode === "register";
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Authentication failed.");
      router.replace("/"); router.refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="mx-auto mt-12 max-w-md rounded-3xl border border-border bg-card p-7 sm:p-9">
    <div className="mb-7"><div className="display-face text-2xl text-ink">Interview <span className="text-accent">Coach</span></div><h1 className="mt-6 text-xl font-semibold text-ink">{register ? "Create your account" : "Welcome back"}</h1><p className="mt-1 text-sm text-muted">{register ? "Your interview sessions will be private to your account." : "Sign in to continue to your practice sessions."}</p></div>
    <form onSubmit={submit} className="space-y-4">
      <label className="block text-sm text-muted">Email<input required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-1.5 w-full rounded-xl border border-border bg-surface px-3.5 py-3 text-ink outline-none focus:border-accent/60" /></label>
      <label className="block text-sm text-muted">Password<input required minLength={register ? 10 : undefined} type="password" autoComplete={register ? "new-password" : "current-password"} value={password} onChange={e => setPassword(e.target.value)} className="mt-1.5 w-full rounded-xl border border-border bg-surface px-3.5 py-3 text-ink outline-none focus:border-accent/60" />{register && <span className="mt-1 block text-xs text-dim">Use at least 10 characters.</span>}</label>
      {error && <p role="alert" className="rounded-xl border border-danger/20 bg-danger-dim px-3 py-2.5 text-sm text-danger">{error}</p>}
      <button disabled={busy} className="w-full rounded-xl bg-forest px-4 py-3 text-sm font-semibold text-white transition-opacity disabled:opacity-50">{busy ? "Please wait…" : register ? "Create account" : "Sign in"}</button>
    </form>
    <p className="mt-5 text-center text-sm text-muted">{register ? "Already registered?" : "New here?"} <a className="font-medium text-accent hover:underline" href={register ? "/login" : "/register"}>{register ? "Sign in" : "Create an account"}</a></p>
  </div>;
}
