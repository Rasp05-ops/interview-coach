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
        <XAxis dataKey="label" tick={{ fill: "#3d4a60", fontSize: 10 }} axisLine={false} tickLine={false} />
        <YAxis domain={[0, 10]} tick={{ fill: "#3d4a60", fontSize: 10 }} axisLine={false} tickLine={false} />
        <ReferenceLine y={7} stroke="#2dd4a0" strokeDasharray="3 3" strokeOpacity={0.4} />
        <ReferenceLine y={5} stroke="#f5a623" strokeDasharray="3 3" strokeOpacity={0.3} />
        <Tooltip
          contentStyle={{ background: "#141920", border: "1px solid #1c2333", borderRadius: 10, fontSize: 12 }}
          labelStyle={{ color: "#6e7d96" }}
          formatter={(v: any, _: any, props: any) => [`${Number(v).toFixed(1)}/10`, props.payload.role]}
        />
        <Line type="monotone" dataKey="score" stroke="#4f80ff" strokeWidth={2}
          dot={{ fill: "#4f80ff", r: 4, strokeWidth: 0 }}
          activeDot={{ r: 6, fill: "#4f80ff" }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
