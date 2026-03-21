'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface BurndownPoint { day: number; remaining: number; }
interface BurndownChartProps { ideal: BurndownPoint[]; actual: BurndownPoint[]; title: string; }

export default function BurndownChart({ ideal, actual, title }: BurndownChartProps) {
  const merged = ideal.map((point) => {
    const actualPoint = actual.find((a) => a.day === point.day);
    return { day: `Day ${point.day}`, ideal: point.remaining, actual: actualPoint?.remaining ?? null };
  });

  return (
    <div className="card p-6">
      <h3 className="text-sm font-semibold mb-5" style={{ color: '#e5e7eb' }}>{title}</h3>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={merged}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={{ background: '#1a1a28', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', fontSize: '12px', color: '#d1d5db' }} />
          <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '12px', color: '#9ca3af' }} />
          <Line type="monotone" dataKey="ideal" stroke="#4b5563" name="Ideal" strokeDasharray="6 4" strokeWidth={1.5} dot={false} />
          <Line type="monotone" dataKey="actual" stroke="#818cf8" name="Actual" strokeWidth={2} dot={false} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
