'use client';

interface FollowupCardProps {
  fu_id: string;
  what: string;
  who: string | null;
  due: string | null;
  priority: string | null;
  status: string;
  onResolve?: (id: number) => void;
  id: number;
}

export default function FollowupCard({
  fu_id, what, who, due, priority, status, onResolve, id,
}: FollowupCardProps) {
  const isOverdue = due && new Date(due) < new Date() && status !== 'resolved';
  const resolved = status === 'resolved';

  return (
    <div className={`card p-4 ${isOverdue ? 'border-l-2 border-l-red-500/60' : resolved ? 'border-l-2 border-l-emerald-500/40 opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className={`text-sm leading-snug ${resolved ? 'line-through' : ''}`}
            style={{ color: resolved ? '#4b5563' : '#d1d5db' }}>
            {what}
          </p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className="text-[10px] font-mono" style={{ color: '#4b5563' }}>{fu_id}</span>
            {who && <span className="badge badge-gray">{who}</span>}
            {due && (
              <span className="text-[11px]" style={{ color: isOverdue ? '#f87171' : '#6b7280' }}>
                {isOverdue ? 'Overdue: ' : 'Due: '}{due}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {priority && (
            <span className={`text-[10px] px-2 py-0.5 rounded-md font-medium priority-${priority}`}>
              {priority}
            </span>
          )}
          {!resolved && onResolve && (
            <button
              onClick={() => onResolve(id)}
              className="text-[11px] font-medium px-2 py-1 rounded-md transition-colors"
              style={{ color: '#4ade80' }}
            >
              Resolve
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
