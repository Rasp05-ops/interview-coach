"use client";
import { ReactNode } from "react";

export function Card({ children, className = "", onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={`bg-card border border-border rounded-[22px] p-5 shadow-[0_12px_36px_rgba(33,76,58,0.06)] ${onClick ? "cursor-pointer hover:-translate-y-0.5 hover:border-accent/45 transition-all" : ""} ${className}`}>
      {children}
    </div>
  );
}

export function Button({ children, onClick, disabled, variant = "primary", size = "md", className = "", type = "button" }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean;
  variant?: "primary" | "ghost" | "danger" | "success"; size?: "sm" | "md" | "lg";
  className?: string; type?: "button" | "submit";
}) {
  const v = {
    primary: "bg-accent hover:bg-accent/85 text-white",
    ghost:   "bg-surface hover:bg-card border border-border text-ink",
    danger:  "bg-danger/15 hover:bg-danger/25 border border-danger/40 text-danger",
    success: "bg-success/15 hover:bg-success/25 border border-success/40 text-success",
  }[variant];
  const s = { sm: "px-3 py-1.5 text-xs", md: "px-4 py-2 text-sm", lg: "px-6 py-3 text-base" }[size];
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`${v} ${s} rounded-xl font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${className}`}>
      {children}
    </button>
  );
}

export function Badge({ children, variant = "default" }: { children: ReactNode; variant?: "default" | "success" | "warning" | "danger" | "accent" }) {
  const v = {
    default: "bg-surface border-border text-muted",
    success: "bg-success-dim border-success/30 text-success",
    warning: "bg-warning-dim border-warning/30 text-warning",
    danger:  "bg-danger-dim border-danger/30 text-danger",
    accent:  "bg-accent-dim border-accent/30 text-accent",
  }[variant];
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${v}`}>{children}</span>;
}

export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="animate-spin flex-shrink-0">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.2" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function ProgressBar({ value, max, color = "accent" }: { value: number; max: number; color?: "accent" | "success" | "warning" | "danger" }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const c = { accent: "bg-accent", success: "bg-success", warning: "bg-warning", danger: "bg-danger" }[color];
  return (
    <div className="w-full bg-surface rounded-full h-1.5 overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-700 ${c}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return null;
  const c = score >= 7 ? "text-success" : score >= 5 ? "text-warning" : "text-danger";
  return <span className={`font-bold text-lg tabular-nums ${c}`}>{score.toFixed(1)}<span className="text-muted text-sm">/10</span></span>;
}

export function Input({ label, value, onChange, placeholder, className = "" }: {
  label?: string; value: string; onChange: (v: string) => void; placeholder?: string; className?: string;
}) {
  return (
    <div className={className}>
      {label && <label className="text-xs font-semibold text-muted uppercase tracking-wide block mb-1.5">{label}</label>}
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full bg-white border border-border rounded-xl px-3 py-3 text-sm text-ink placeholder:text-dim focus:outline-none focus:border-accent focus:ring-4 focus:ring-accent/10 transition-colors" />
    </div>
  );
}
