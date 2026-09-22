"use client";
import { ReactNode } from "react";

export function IconArrowRight({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <path d="M3 8h10m0 0L9 4m4 4L9 12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconArrowLeft({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <path d="M13 8H3m0 0l4-4M3 8l4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconCheck({ size = 12, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M2.5 7.2l3 3.2 6-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconX({ size = 12, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" className={className}>
      <path d="M3 3l8 8M11 3l-8 8" strokeLinecap="round" />
    </svg>
  );
}

export function IconPlus({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" className={className}>
      <path d="M7 1.5v11M1.5 7h11" strokeLinecap="round" />
    </svg>
  );
}

export function Card({ children, className = "", onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={`bg-card border border-border rounded-2xl p-5 transition-all duration-200 ${
        onClick ? "cursor-pointer hover:border-accent/40 hover:-translate-y-[1px] hover:bg-elevated" : ""
      } ${className}`}
    >
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
    primary: "bg-accent text-forest hover:bg-accent-soft shadow-[0_1px_0_rgba(255,255,255,0.15)_inset] hover:shadow-[0_8px_24px_rgba(201,162,75,0.22)]",
    ghost:   "bg-transparent hover:bg-elevated border border-border hover:border-accent/40 text-ink",
    danger:  "bg-danger-dim hover:bg-danger/15 border border-danger/25 text-danger",
    success: "bg-success-dim hover:bg-success/15 border border-success/25 text-success",
  }[variant];
  const s = { sm: "px-3 py-1.5 text-xs", md: "px-4 py-2.5 text-sm", lg: "px-5 py-3 text-[15px]" }[size];
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={`${v} ${s} rounded-xl font-medium transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none disabled:hover:translate-y-0 flex items-center justify-center gap-2 active:scale-[0.98] ${className}`}>
      {children}
    </button>
  );
}

export function Badge({ children, variant = "default" }: { children: ReactNode; variant?: "default" | "success" | "warning" | "danger" | "accent" }) {
  const v = {
    default: "border-border text-muted",
    success: "border-success/25 text-success",
    warning: "border-warning/25 text-warning",
    danger:  "border-danger/25 text-danger",
    accent:  "border-accent/30 text-accent-soft",
  }[variant];
  return <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium border bg-black/20 ${v}`}>{children}</span>;
}

export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="animate-spin flex-shrink-0">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeOpacity="0.18" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function ProgressBar({ value, max, color = "accent" }: { value: number; max: number; color?: "accent" | "success" | "warning" | "danger" }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const c = { accent: "bg-accent", success: "bg-success", warning: "bg-warning", danger: "bg-danger" }[color];
  return (
    <div className="w-full bg-elevated rounded-full h-1.5 overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-700 ease-out ${c}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return null;
  const c = score >= 7 ? "text-success" : score >= 5 ? "text-warning" : "text-danger";
  return (
    <span className={`display-face text-lg tabular-nums ${c}`}>
      {score.toFixed(1)}<span className="text-dim text-sm">/10</span>
    </span>
  );
}

export function Input({ label, value, onChange, placeholder, className = "" }: {
  label?: string; value: string; onChange: (v: string) => void; placeholder?: string; className?: string;
}) {
  return (
    <div className={className}>
      {label && <label className="text-[13px] text-muted block mb-1.5">{label}</label>}
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full bg-surface border border-border rounded-xl px-3.5 py-3 text-sm text-ink placeholder:text-dim focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/15 transition-colors" />
    </div>
  );
}