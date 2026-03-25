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
  who_name?: string | null;
  due: string | null;
  priority: string | null;
  status: string;
  source?: string | null;
  source_id?: string | null;
  checklist?: ChecklistItem[] | null;
  onToggleItem?: (fuId: string, itemIndex: number) => void;
  onEdit?: (fuId: string) => void;
  onDelete?: (fuId: string) => void;
  onStatusChange?: (fuId: string, status: string) => void;
  id: number;
}

const statusColors: Record<string, { bg: string; color: string }> = {
  open: { bg: 'rgba(156,163,175,0.12)', color: '#9ca3af' },
  in_progress: { bg: 'rgba(99,102,241,0.12)', color: '#818cf8' },
  resolved: { bg: 'rgba(34,197,94,0.12)', color: '#4ade80' },
  overdue: { bg: 'rgba(239,68,68,0.12)', color: '#f87171' },
};

const AVATAR_COLORS = ['#818cf8', '#f472b6', '#34d399', '#fbbf24', '#fb923c', '#a78bfa', '#22d3ee', '#f87171'];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return fullName.slice(0, 2).toUpperCase();
}

export default function FollowupCard({
  fu_id, what, who, who_name, due, priority, status, source, source_id, checklist,
  onToggleItem, onEdit, onDelete, onStatusChange, id,
}: FollowupCardProps) {
  const [expanded, setExpanded] = useState(source === 'standup' || source === 'meeting' || source === 'voice');
  const [localChecklist, setLocalChecklist] = useState<ChecklistItem[] | null>(null);
  const isOverdue = due && new Date(due) < new Date() && status !== 'resolved';
  const resolved = status === 'resolved';

  const items = localChecklist || checklist || [];
  const pendingItems = items.filter((i) => !i.completed);
  const completedItems = items.filter((i) => i.completed);
  const doneCount = completedItems.length;
  const totalCount = items.length;
  const hasChecklist = totalCount > 0;
  const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  // Clean title — strip employee name from "Daily commitments — Name" or "Meeting action items — Title"
  const isMeeting = source === 'meeting';
  const isStandup = source === 'standup';
  let heading = '';
  let subtitle = '';

  if (isMeeting && what.includes(' — ')) {
    subtitle = what.split(' — ')[0]; // "Meeting action items"
    heading = what.split(' — ').slice(1).join(' — '); // "Morning Standup"
  } else if (isStandup && what.includes(' — ')) {
    subtitle = what.split(' — ')[0]; // "Daily commitments"
    heading = who_name || who || '';
  } else {
    heading = who_name || who || '';
    subtitle = what;
  }

  const sourceLink = source === 'standup'
    ? { label: 'Standup', bg: 'rgba(99,102,241,0.1)', color: '#818cf8', href: '/updates' }
    : source === 'meeting'
    ? { label: 'Meeting', bg: 'rgba(245,158,11,0.1)', color: '#f59e0b', href: '/fireflies' }
    : source === 'voice'
    ? { label: '🎙 Voice', bg: 'rgba(168,85,247,0.1)', color: '#a78bfa', href: '/voice' }
    : source && source !== 'manual' && source !== 'dashboard'
    ? { label: source, bg: 'rgba(255,255,255,0.04)', color: '#6b7280', href: null }
    : null;

  const sc = statusColors[status] || statusColors.open;
  const displayName = who_name || who || '';
  const avatarColor = displayName ? getAvatarColor(displayName) : '#6b7280';
  const initials = displayName ? getInitials(displayName) : '';

  const handleToggle = (origIdx: number) => {
    const updated = [...items];
    updated[origIdx] = { ...updated[origIdx], completed: !updated[origIdx].completed };
    setLocalChecklist(updated);
    onToggleItem?.(fu_id, origIdx);
    setTimeout(() => setLocalChecklist(null), 1500);
  };

  return (
    <div className={`card p-0 overflow-hidden ${isOverdue ? 'border-l-2 border-l-red-500/60' : resolved ? 'border-l-2 border-l-emerald-500/40 opacity-60' : ''}`}>
      {/* Header */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-start gap-3">
          {/* Avatar or meeting icon */}
          {isMeeting ? (
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-[14px]"
              style={{ background: 'rgba(245,158,11,0.1)', border: '1.5px solid rgba(245,158,11,0.25)' }}>
              📋
            </div>
          ) : displayName ? (
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-[11px] font-bold"
              style={{ background: avatarColor + '20', color: avatarColor, border: `1.5px solid ${avatarColor}35` }}>
              {initials}
            </div>
          ) : (
            <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-[14px]"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1.5px solid rgba(255,255,255,0.08)' }}>
              📌
            </div>
          )}

          <div className="flex-1 min-w-0">
            {/* Heading — employee name (standup) or meeting title (meeting) */}
            <p className="text-[13px] font-semibold leading-tight" style={{ color: isMeeting ? '#f59e0b' : displayName ? avatarColor : '#d1d5db' }}>
              {heading || subtitle}
            </p>
            {/* Subtitle — task description */}
            {heading && subtitle && (
              <p className={`text-[11px] mt-0.5 leading-snug ${resolved ? 'line-through' : ''}`}
                style={{ color: resolved ? '#4b5563' : '#9ca3af' }}>
                {subtitle}
              </p>
            )}
            {/* Metadata row — NO who badge (already shown as heading) */}
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
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
              {due && (
                <span className="text-[10px]" style={{ color: isOverdue ? '#f87171' : '#6b7280' }}>
                  {isOverdue ? 'Overdue: ' : 'Due: '}{due}
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5 shrink-0">
            {priority && (
              <span className={`text-[10px] px-2 py-0.5 rounded-md font-medium priority-${priority}`}>
                {priority}
              </span>
            )}
            {onStatusChange && (
              <select
                value={status}
                onChange={(e) => { e.stopPropagation(); onStatusChange(fu_id, e.target.value); }}
                onClick={(e) => e.stopPropagation()}
                className="text-[10px] font-semibold rounded-lg px-2.5 py-1 cursor-pointer outline-none transition-all"
                style={{
                  background: sc.bg, color: sc.color,
                  border: `1px solid ${sc.color}30`,
                  appearance: 'auto', WebkitAppearance: 'menulist', minWidth: '90px',
                }}
              >
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="resolved">Resolved</option>
              </select>
            )}
            {onEdit && (
              <button onClick={(e) => { e.stopPropagation(); onEdit(fu_id); }}
                className="text-[11px] px-1.5 py-1 rounded transition-colors hover:bg-white/[0.06]"
                style={{ color: '#6b7280' }} title="Edit">✎</button>
            )}
            {onDelete && (
              <button onClick={(e) => { e.stopPropagation(); onDelete(fu_id); }}
                className="text-[11px] px-1.5 py-1 rounded transition-colors hover:bg-red-500/10"
                style={{ color: '#6b7280' }} title="Delete">✕</button>
            )}
          </div>
        </div>
      </div>

      {/* Checklist Section */}
      {hasChecklist && (
        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <div className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${progressPct}%`,
                  background: progressPct === 100
                    ? 'linear-gradient(90deg, #4ade80, #22c55e)'
                    : progressPct > 50
                    ? 'linear-gradient(90deg, #818cf8, #6366f1)'
                    : 'linear-gradient(90deg, #818cf8, #a78bfa)',
                }}
              />
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
              className="text-[10px] font-semibold shrink-0 px-2 py-0.5 rounded-md transition-all hover:bg-white/[0.04]"
              style={{ color: progressPct === 100 ? '#4ade80' : '#9ca3af' }}
            >
              {doneCount}/{totalCount} {expanded ? '▾' : '▸'}
            </button>
          </div>

          {expanded && (
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
              {pendingItems.length > 0 && (
                <div>
                  <div className="px-3 py-1.5" style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: '#6b7280' }}>
                      To Do ({pendingItems.length})
                    </span>
                  </div>
                  {pendingItems.map((item) => {
                    const origIdx = items.indexOf(item);
                    return (
                      <div key={origIdx}
                        onClick={(e) => { e.stopPropagation(); handleToggle(origIdx); }}
                        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-all hover:bg-indigo-500/[0.04] group"
                        style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                      >
                        <div className="w-[18px] h-[18px] rounded border-2 flex items-center justify-center shrink-0 transition-all group-hover:border-indigo-400/50 group-hover:bg-indigo-500/10"
                          style={{ borderColor: 'rgba(255,255,255,0.15)', background: 'transparent' }}
                        />
                        <span className="text-[12px] flex-1 leading-snug" style={{ color: '#d1d5db' }}>{item.text}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0 priority-${item.priority}`}>
                          {item.priority}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {completedItems.length > 0 && (
                <div style={{ background: 'rgba(34,197,94,0.02)' }}>
                  <div className="px-3 py-1.5" style={{ background: 'rgba(34,197,94,0.04)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: '#4ade80' }}>
                      Completed ({completedItems.length})
                    </span>
                  </div>
                  {completedItems.map((item) => {
                    const origIdx = items.indexOf(item);
                    return (
                      <div key={origIdx}
                        onClick={(e) => { e.stopPropagation(); handleToggle(origIdx); }}
                        className="flex items-center gap-3 px-3 py-2 cursor-pointer transition-all hover:bg-white/[0.03] group"
                        style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}
                      >
                        <div className="w-[18px] h-[18px] rounded flex items-center justify-center shrink-0 transition-all group-hover:opacity-70"
                          style={{ background: 'rgba(34,197,94,0.15)', border: '2px solid rgba(34,197,94,0.4)' }}
                        >
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path d="M2 5L4.5 7.5L8 3" stroke="#4ade80" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>
                        <span className="text-[12px] flex-1 line-through leading-snug" style={{ color: '#4b5563' }}>{item.text}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0 opacity-50 priority-${item.priority}`}>
                          {item.priority}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
