"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

interface Point { label: string; score: number; role: string; }

interface Props { data: Point[]; }

export default function ScoreTrendChart({ data }: Props) {
  if (data.length < 2) return (
    <div className="flex items-center justify-center h-32 text-dim text-sm">
      Complete at least 2 interviews to see your trend
    </div>
  );

  return (
    <ResponsiveContainer width="100%" height={160}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
        <XAxis dataKey="label" tick={{ fill: "#63656d", fontSize: 10 }} axisLine={false} tickLine={false} />
        <YAxis domain={[0, 10]} tick={{ fill: "#63656d", fontSize: 10 }} axisLine={false} tickLine={false} />
        <ReferenceLine y={7} stroke="#7fae83" strokeDasharray="3 3" strokeOpacity={0.4} />
        <ReferenceLine y={5} stroke="#c2823f" strokeDasharray="3 3" strokeOpacity={0.3} />
        <Tooltip
          contentStyle={{ background: "#16181d", border: "1px solid #25282f", borderRadius: 10, fontSize: 12 }}
          labelStyle={{ color: "#9a9ca3" }}
          itemStyle={{ color: "#eeece5" }}
          formatter={(v: any, _: any, props: any) => [`${Number(v).toFixed(1)}/10`, props.payload.role]}
        />
        <Line type="monotone" dataKey="score" stroke="#c9a24b" strokeWidth={2}
          dot={{ fill: "#c9a24b", r: 4, strokeWidth: 0 }}
          activeDot={{ r: 6, fill: "#d9bb75" }} />
      </LineChart>
    </ResponsiveContainer>
  );
}