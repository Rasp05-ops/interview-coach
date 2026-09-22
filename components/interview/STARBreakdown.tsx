"use client";
import { IconCheck, IconX } from "@/components/ui";

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
      <div className="text-xs text-dim mb-2.5">STAR structure</div>
      <div className="grid grid-cols-4 gap-2">
        {parts.map(p => {
          const hit = star[p.key as keyof STARData] as boolean;
          return (
            <div key={p.key} className={`rounded-xl p-2.5 text-center border transition-colors
              ${hit ? "bg-success-dim border-success/25" : "bg-black/10 border-border"}`}>
              <div className={`display-face text-lg ${hit ? "text-success" : "text-dim"}`}>{p.label}</div>
              <div className={`text-[10px] font-medium ${hit ? "text-success" : "text-dim"}`}>{p.full}</div>
              <div className="text-[9px] text-dim mt-0.5">{p.desc}</div>
              <div className="mt-1 flex justify-center">{hit ? <IconCheck className="text-success" /> : <IconX className="text-dim" />}</div>
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