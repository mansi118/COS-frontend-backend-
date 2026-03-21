interface HealthBadgeProps {
  health: string;
}

const healthMap: Record<string, { dot: string; label: string; cls: string }> = {
  green: { dot: 'bg-emerald-400', label: 'Healthy', cls: 'badge-green' },
  yellow: { dot: 'bg-amber-400', label: 'Watch', cls: 'badge-yellow' },
  orange: { dot: 'bg-orange-400', label: 'At Risk', cls: 'badge-orange' },
  red: { dot: 'bg-red-400', label: 'Critical', cls: 'badge-red' },
};

export default function HealthBadge({ health }: HealthBadgeProps) {
  const h = healthMap[health] || healthMap.green;
  return (
    <span className={`badge ${h.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${h.dot}`} />
      {h.label}
    </span>
  );
}
