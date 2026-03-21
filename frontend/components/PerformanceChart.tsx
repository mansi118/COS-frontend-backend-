'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface DataPoint {
  date: string;
  score: number;
  completion_rate: number;
  on_time_rate: number;
}

interface PerformanceChartProps {
  data: DataPoint[];
  title: string;
}

export default function PerformanceChart({ data, title }: PerformanceChartProps) {
  return (
    <div className="card p-6">
      <h3 className="text-sm font-semibold mb-5" style={{ color: '#e5e7eb' }}>{title}</h3>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: '#1a1a28', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', fontSize: '12px', color: '#d1d5db' }} />
          <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '12px', color: '#9ca3af' }} />
          <Line type="monotone" dataKey="score" stroke="#818cf8" name="Score" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="completion_rate" stroke="#4ade80" name="Completion %" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="on_time_rate" stroke="#fb923c" name="On-time %" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
