"use client";

interface STARData {
  situation: boolean;
  task: boolean;
  action: boolean;
  result: boolean;
  score: number;
}

export default function STARBreakdown({ star }: { star: STARData }) {
  const parts = [
    { key: "situation", label: "S", full: "Situation",  desc: "Set the scene" },
    { key: "task",      label: "T", full: "Task",       desc: "Defined the problem" },
    { key: "action",    label: "A", full: "Action",     desc: "What you did" },
    { key: "result",    label: "R", full: "Result",     desc: "Measurable outcome" },
  ] as const;

  return (
    <div>
      <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-2.5">STAR Structure</div>
      <div className="grid grid-cols-4 gap-2">
        {parts.map(p => {
          const hit = star[p.key as keyof STARData] as boolean;
          return (
            <div key={p.key} className={`rounded-xl p-2.5 text-center border transition-colors
              ${hit ? "bg-success-dim border-success/30" : "bg-surface border-border"}`}>
              <div className={`text-lg font-bold ${hit ? "text-success" : "text-dim"}`}>{p.label}</div>
              <div className={`text-[10px] font-semibold ${hit ? "text-success" : "text-dim"}`}>{p.full}</div>
              <div className="text-[9px] text-muted mt-0.5">{p.desc}</div>
              <div className="mt-1 text-sm">{hit ? "✓" : "✗"}</div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 text-xs text-muted">
        STAR score: <span className={star.score >= 75 ? "text-success" : star.score >= 50 ? "text-warning" : "text-danger"}>{star.score}%</span>
        {star.score < 75 && <span className="ml-2">— missing {parts.filter(p => !(star[p.key as keyof STARData] as boolean)).map(p => p.full).join(", ")}</span>}
      </div>
    </div>
  );
}
