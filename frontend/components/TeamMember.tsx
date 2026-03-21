import HealthBadge from './HealthBadge';

interface Task {
  fu_id: string;
  what: string;
  due: string | null;
  priority: string;
}

interface TeamMemberProps {
  name: string;
  role: string;
  emoji: string;
  health: string;
  reliability: number;
  active_count: number;
  overdue_count: number;
  active_tasks: Task[];
  score: number | null;
}

export default function TeamMemberCard({
  name, role, emoji, health, reliability, active_count, overdue_count, active_tasks, score,
}: TeamMemberProps) {
  const workloadPct = Math.min(100, active_count * 20);
  const barColor = workloadPct > 80 ? 'bg-red-400' : workloadPct > 60 ? 'bg-amber-400' : 'bg-emerald-400';

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-5 pt-5 pb-3">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
              {emoji || name.charAt(0)}
            </div>
            <div>
              <h3 className="font-semibold text-sm" style={{ color: '#e5e7eb' }}>{name}</h3>
              <p className="text-[11px]" style={{ color: '#6b7280' }}>{role}</p>
            </div>
          </div>
          <HealthBadge health={health} />
        </div>

        <div className="flex items-center gap-3 text-[11px] mb-3">
          <span className="badge badge-blue">{active_count} active</span>
          {overdue_count > 0 && <span className="badge badge-red">{overdue_count} overdue</span>}
          <span style={{ color: '#6b7280' }}>{reliability}% on-time</span>
          {score !== null && <span style={{ color: '#6b7280' }}>Score {score}</span>}
        </div>

        <div className="w-full rounded-full h-1.5" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div className={`h-1.5 rounded-full transition-all ${barColor}`} style={{ width: `${workloadPct}%` }} />
        </div>
      </div>

      {active_tasks.length > 0 && (
        <div className="px-5 py-3 space-y-2" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
          {active_tasks.slice(0, 3).map((task) => (
            <div key={task.fu_id} className="flex items-center justify-between">
              <span className="text-[12px] truncate flex-1 leading-tight" style={{ color: '#9ca3af' }}>{task.what}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-md ml-2 font-medium priority-${task.priority}`}>
                {task.priority}
              </span>
            </div>
          ))}
          {active_tasks.length > 3 && (
            <p className="text-[11px]" style={{ color: '#4b5563' }}>+{active_tasks.length - 3} more</p>
          )}
        </div>
      )}
    </div>
  );
}
