'use client';

import { useEffect, useRef, useState } from 'react';

interface StatCardProps {
  label: string;
  value: number | string;
  borderColor: 'green' | 'yellow' | 'red' | 'blue';
  subtitle?: string;
  trend?: number[];
  trendGood?: 'up' | 'down' | 'neutral';
}

function Sparkline({ data, good = 'neutral' }: { data: number[]; good?: 'up' | 'down' | 'neutral' }) {
  if (data.length < 2) return null;

  const w = 64;
  const h = 22;
  const padding = 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = padding + (i / (data.length - 1)) * (w - padding * 2);
    const y = padding + (1 - (v - min) / range) * (h - padding * 2);
    return `${x},${y}`;
  }).join(' ');

  const first = data[0];
  const last = data[data.length - 1];
  let color = '#6b7280';
  if (good === 'up' && last > first) color = '#4ade80';
  else if (good === 'up' && last < first) color = '#f87171';
  else if (good === 'down' && last < first) color = '#4ade80';
  else if (good === 'down' && last > first) color = '#f87171';
  else if (good === 'neutral') color = '#818cf8';

  return (
    <svg width={w} height={h} className="mt-1.5" style={{ opacity: 0.8 }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {data.length > 0 && (() => {
        const lx = padding + ((data.length - 1) / (data.length - 1)) * (w - padding * 2);
        const ly = padding + (1 - (last - min) / range) * (h - padding * 2);
        return <circle cx={lx} cy={ly} r="2" fill={color} />;
      })()}
    </svg>
  );
}

export default function StatCard({ label, value, borderColor, subtitle, trend, trendGood }: StatCardProps) {
  const numValue = typeof value === 'number' ? value : parseInt(String(value)) || 0;
  const isNumeric = typeof value === 'number' || !isNaN(parseInt(String(value)));
  const [displayValue, setDisplayValue] = useState(numValue);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const prevValue = useRef(numValue);

  // Animate number transition
  useEffect(() => {
    if (!isNumeric) { setDisplayValue(numValue); return; }
    const start = prevValue.current;
    const diff = numValue - start;
    if (diff === 0) return;

    // Flash highlight
    const isGood = (trendGood === 'up' && diff > 0) || (trendGood === 'down' && diff < 0);
    const isBad = (trendGood === 'up' && diff < 0) || (trendGood === 'down' && diff > 0);
    setFlash(isGood ? 'up' : isBad ? 'down' : null);
    setTimeout(() => setFlash(null), 1200);

    const duration = 600;
    const startTime = Date.now();
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      setDisplayValue(Math.round(start + diff * eased));
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
    prevValue.current = numValue;
  }, [numValue]);

  const flashStyle = flash === 'up'
    ? { boxShadow: '0 0 20px rgba(34,197,94,0.3)', transition: 'box-shadow 1.2s ease-out' }
    : flash === 'down'
    ? { boxShadow: '0 0 20px rgba(239,68,68,0.3)', transition: 'box-shadow 1.2s ease-out' }
    : { boxShadow: 'none', transition: 'box-shadow 1.2s ease-out' };

  return (
    <div className={`card p-5 stat-${borderColor}`} style={flashStyle}>
      <p className="text-[11px] font-medium uppercase tracking-wider mb-1" style={{ color: '#6b7280' }}>{label}</p>
      <div className="flex items-end justify-between">
        <div>
          <p className="text-2xl font-bold tabular-nums" style={{ color: '#e5e7eb' }}>
            {isNumeric ? displayValue : value}
            {flash && (
              <span className="text-[10px] ml-1.5 font-medium" style={{
                color: flash === 'up' ? '#4ade80' : '#f87171',
                animation: 'fadeOut 1.2s ease-out forwards',
              }}>
                {flash === 'up' ? '▲' : '▼'}
              </span>
            )}
          </p>
          {subtitle && <p className="text-xs mt-0.5" style={{ color: '#4b5563' }}>{subtitle}</p>}
        </div>
        {trend && trend.length >= 2 ? (
          <Sparkline data={trend} good={trendGood} />
        ) : trend ? (
          <span className="text-[9px] italic" style={{ color: '#4b5563' }}>collecting...</span>
        ) : null}
      </div>
    </div>
  );
}
