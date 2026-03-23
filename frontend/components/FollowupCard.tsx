'use client';

import { useState } from 'react';

interface ChecklistItem {
  text: string;
  priority: string;
  completed: boolean;
}

interface FollowupCardProps {
  fu_id: string;
  what: string;
  who: string | null;
  due: string | null;
  priority: string | null;
  status: string;
  source?: string | null;
  source_id?: string | null;
  checklist?: ChecklistItem[] | null;
  onResolve?: (id: number) => void;
  onToggleItem?: (fuId: string, itemIndex: number) => void;
  id: number;
}

export default function FollowupCard({
  fu_id, what, who, due, priority, status, source, source_id, checklist, onResolve, onToggleItem, id,
}: FollowupCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isOverdue = due && new Date(due) < new Date() && status !== 'resolved';
  const resolved = status === 'resolved';

  const items = checklist || [];
  const doneCount = items.filter((i) => i.completed).length;
  const totalCount = items.length;
  const hasChecklist = totalCount > 0;

  const sourceLink = source === 'standup'
    ? { label: 'Standup', bg: 'rgba(99,102,241,0.1)', color: '#818cf8', href: '/updates' }
    : source === 'meeting'
    ? { label: 'Meeting', bg: 'rgba(245,158,11,0.1)', color: '#f59e0b', href: '/fireflies' }
    : source && source !== 'manual' && source !== 'dashboard'
    ? { label: source, bg: 'rgba(255,255,255,0.04)', color: '#6b7280', href: null }
    : null;

  return (
    <div className={`card p-4 ${isOverdue ? 'border-l-2 border-l-red-500/60' : resolved ? 'border-l-2 border-l-emerald-500/40 opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className={`text-sm leading-snug ${resolved ? 'line-through' : ''}`}
            style={{ color: resolved ? '#4b5563' : '#d1d5db' }}>
            {what}
          </p>

          {/* Checklist progress bar */}
          {hasChecklist && (
            <div className="mt-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${totalCount > 0 ? (doneCount / totalCount) * 100 : 0}%`,
                      background: doneCount === totalCount ? '#4ade80' : '#818cf8',
                    }}
                  />
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                  className="text-[10px] font-medium shrink-0 hover:opacity-80 transition-opacity"
                  style={{ color: doneCount === totalCount ? '#4ade80' : '#9ca3af' }}
                >
                  {doneCount}/{totalCount} done {expanded ? '▾' : '▸'}
                </button>
              </div>

              {/* Expanded checklist */}
              {expanded && (
                <div className="mt-2 space-y-1">
                  {items.map((item, i) => (
                    <div key={i} className="flex items-start gap-2 py-1 px-1 rounded group" style={{ background: 'rgba(255,255,255,0.02)' }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleItem?.(fu_id, i); }}
                        className="text-[11px] shrink-0 mt-0.5 w-4 h-4 flex items-center justify-center rounded transition-colors cursor-pointer"
                        style={{
                          color: item.completed ? '#4ade80' : '#4b5563',
                          background: item.completed ? 'rgba(34,197,94,0.1)' : 'transparent',
                        }}
                        title={item.completed ? 'Uncheck' : 'Check'}
                      >
                        {item.completed ? '✓' : '○'}
                      </button>
                      <span className={`text-[11px] flex-1 ${item.completed ? 'line-through' : ''}`}
                        style={{ color: item.completed ? '#4b5563' : '#d1d5db' }}>
                        {item.text}
                      </span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0 priority-${item.priority}`}>
                        {item.priority}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className="text-[10px] font-mono" style={{ color: '#4b5563' }}>{fu_id}</span>
            {sourceLink && (
              sourceLink.href ? (
                <a href={sourceLink.href} onClick={(e) => e.stopPropagation()}
                  className="text-[9px] px-1.5 py-0.5 rounded font-medium transition-opacity hover:opacity-80"
                  style={{ background: sourceLink.bg, color: sourceLink.color }}>
                  {sourceLink.label}
                </a>
              ) : (
                <span className="text-[9px] px-1.5 py-0.5 rounded font-medium"
                  style={{ background: sourceLink.bg, color: sourceLink.color }}>
                  {sourceLink.label}
                </span>
              )
            )}
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
