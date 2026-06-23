"use client";
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from "recharts";

export function PhaseStrip({ data }: { data: { phase: string; strike_rate: number }[] }) {
  return (
    <div className="tile h-48">
      <div className="text-muted text-xs uppercase mb-2">Strike rate by phase</div>
      <ResponsiveContainer width="100%" height="80%">
        <BarChart data={data}>
          <XAxis dataKey="phase" stroke="#8A94A6" fontSize={11} />
          <Tooltip contentStyle={{ background: "#161C28", border: "1px solid #222B3A" }} />
          <Bar dataKey="strike_rate" fill="#1F6FEB" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
