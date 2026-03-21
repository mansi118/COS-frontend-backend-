interface StatCardProps {
  label: string;
  value: number | string;
  borderColor: 'green' | 'yellow' | 'red' | 'blue';
  subtitle?: string;
}

export default function StatCard({ label, value, borderColor, subtitle }: StatCardProps) {
  return (
    <div className={`card p-5 stat-${borderColor}`}>
      <p className="text-[11px] font-medium uppercase tracking-wider mb-1" style={{ color: '#6b7280' }}>{label}</p>
      <p className="text-2xl font-bold tabular-nums" style={{ color: '#e5e7eb' }}>{value}</p>
      {subtitle && <p className="text-xs mt-0.5" style={{ color: '#4b5563' }}>{subtitle}</p>}
    </div>
  );
}
