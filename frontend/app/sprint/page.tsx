'use client';

import { useEffect, useState } from 'react';
import BurndownChart from '@/components/BurndownChart';
import useWebSocket from '@/components/useWebSocket';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const EXECUTE_URL = `${API}/api/execute`;

interface SprintData {
  name: string;
  start_date: string;
  end_date: string;
  goals: string[];
  total_tasks: number;
  done_tasks: number;
  open_tasks?: number;
  overdue_tasks?: number;
  done_pct: number;
  time_pct: number;
  elapsed_days: number;
  total_days: number;
  total_items?: number;
  done_items?: number;
  items_pct?: number;
  velocity?: number;
}

interface StandupDay {
  date: string;
  posted: number;
  total: number;
  mood: string;
  highlights: string[];
  blockers: number;
}

interface StandupActivity {
  days: StandupDay[];
  mood_trend: Array<{ date: string; mood: string; score: number | null }>;
}

interface BurndownData {
  ideal: Array<{ day: number; remaining: number }>;
  actual: Array<{ day: number; remaining: number }>;
}

interface MemberUpdate {
  id: number;
  person: string;
  name: string;
  emoji: string;
  role: string;
  accomplished: string;
  blockers: string | null;
  plan_next_week: string | null;
  mood: string;
  notified_slack: boolean;
  notified_email: boolean;
  created_at: string | null;
}

interface WeekGroup {
  week: string;
  updates: MemberUpdate[];
}

const AVATAR_COLORS = ['#818cf8', '#f472b6', '#34d399', '#fbbf24', '#fb923c', '#a78bfa', '#22d3ee', '#f87171'];
function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const moodConfig: Record<string, { emoji: string; label: string; color: string; bg: string; border: string }> = {
  great:      { emoji: '🟢', label: 'Great',      color: 'text-emerald-400', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  good:       { emoji: '🙂', label: 'Good',       color: 'text-blue-400',    bg: 'bg-blue-50',    border: 'border-blue-200' },
  neutral:    { emoji: '😐', label: 'Neutral',    color: 'text-gray-500',    bg: 'bg-white/[0.03]',    border: 'border-gray-200' },
  struggling: { emoji: '🟠', label: 'Struggling', color: 'text-orange-400',  bg: 'bg-orange-50',  border: 'border-orange-200' },
  blocked:    { emoji: '🔴', label: 'Blocked',    color: 'text-red-400',     bg: 'bg-red-50',     border: 'border-red-200' },
};

export default function SprintPage() {
  const [sprint, setSprint] = useState<SprintData | null>(null);
  const [burndown, setBurndown] = useState<BurndownData | null>(null);
  const [weekGroups, setWeekGroups] = useState<WeekGroup[]>([]);
  const [activity, setActivity] = useState<StandupActivity | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [newUpdate, setNewUpdate] = useState({
    person: '', accomplished: '', blockers: '', plan_next_week: '', mood: 'good',
  });
  const { lastMessage } = useWebSocket();

  const load = () => {
    fetch(`${API}/api/sprint`).then((r) => r.json()).then(setSprint);
    fetch(`${API}/api/sprint/burndown`).then((r) => r.json()).then(setBurndown);
    fetch(`${API}/api/sprint/updates/by-week`).then((r) => r.json()).then((d) => setWeekGroups(d.weeks || []));
    fetch(`${API}/api/sprint/standup-activity`).then((r) => r.json()).then(setActivity).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (lastMessage?.type === 'sprint_update') {
      load();
    }
  }, [lastMessage]);

  const createUpdate = async () => {
    await fetch(`${API}/api/sprint/updates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newUpdate),
    });
    setShowCreate(false);
    setNewUpdate({ person: '', accomplished: '', blockers: '', plan_next_week: '', mood: 'good' });
    load();
  };

  const autoGenerate = async () => {
    setGenerating(true);
    try {
      const res = await fetch(`${API}/api/sprint/updates/auto-generate`, { method: 'POST' });
      const data = await res.json();
      if (data.created > 0) {
        setSendResult(`Generated ${data.created} update(s) for ${data.week} from standups`);
        load();
      } else if (data.skipped > 0) {
        setSendResult(`All ${data.skipped} members already have updates this week`);
      } else {
        setSendResult(data.error || 'No standup data to generate from');
      }
    } catch { setSendResult('Failed to generate'); }
    finally { setGenerating(false); setTimeout(() => setSendResult(null), 5000); }
  };

  const sendUpdates = async (channel: string, weekLabel?: string) => {
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch(EXECUTE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send_sprint_updates',
          args: { week: weekLabel || 'current', channel },
        }),
      });
      const data = await res.json();
      setSendResult(data.success ? (data.result || 'Sent via OpenClaw') : `Failed: ${data.error}`);
      setTimeout(() => { setSendResult(null); load(); }, 5000);
    } catch {
      setSendResult('Failed to connect');
    } finally {
      setSending(false);
    }
  };

  if (!sprint) {
    return <div className="text-sm text-gray-500">Loading sprint data...</div>;
  }

  const onTrack = sprint.done_pct >= sprint.time_pct - 10;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-100">Sprint View</h2>
          <p className="text-[12px] text-gray-500 mt-0.5">{sprint.name}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={autoGenerate} disabled={generating}
            className="btn btn-secondary text-[12px] disabled:opacity-40">
            {generating ? 'Generating...' : 'Auto-Generate from Standups'}
          </button>
          <button onClick={() => setShowCreate(true)} className="btn btn-primary text-[12px]">
            + Add Update
          </button>
        </div>
      </div>

      {/* Sprint Status */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="text-sm font-semibold text-gray-100">{sprint.name}</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">{sprint.start_date} — {sprint.end_date}</p>
          </div>
          <span className={`badge ${onTrack ? 'badge-green' : 'badge-red'}`}>
            {onTrack ? 'On Track' : 'Behind'}
          </span>
        </div>

        <div className="space-y-4">
          {/* Work done bar */}
          <div>
            <div className="flex justify-between text-[11px] mb-1.5">
              <span className="text-gray-500 font-medium">Work Done</span>
              <span className="font-semibold text-gray-600">{sprint.done_pct}%</span>
            </div>
            <div className="w-full bg-white/[0.04] rounded-full h-2">
              <div className="bg-indigo-500 h-2 rounded-full transition-all" style={{ width: `${sprint.done_pct}%` }} />
            </div>
          </div>

          {/* Time elapsed bar */}
          <div>
            <div className="flex justify-between text-[11px] mb-1.5">
              <span className="text-gray-500 font-medium">Time Elapsed</span>
              <span className="font-semibold text-gray-600">{sprint.time_pct}%<span className="text-gray-500 font-normal ml-1">({sprint.elapsed_days}/{sprint.total_days}d)</span></span>
            </div>
            <div className="w-full bg-white/[0.04] rounded-full h-2">
              <div className="bg-gray-300 h-2 rounded-full transition-all" style={{ width: `${sprint.time_pct}%` }} />
            </div>
          </div>

          {/* Checklist items progress */}
          {(sprint.total_items ?? 0) > 0 && (
            <div>
              <div className="flex justify-between text-[11px] mb-1.5">
                <span className="text-gray-500 font-medium">Checklist Items</span>
                <span className="font-semibold" style={{ color: sprint.items_pct === 100 ? '#4ade80' : '#818cf8' }}>
                  {sprint.done_items}/{sprint.total_items} done ({sprint.items_pct}%)
                </span>
              </div>
              <div className="w-full bg-white/[0.04] rounded-full h-2">
                <div className="h-2 rounded-full transition-all" style={{
                  width: `${sprint.items_pct}%`,
                  background: sprint.items_pct === 100 ? '#4ade80' : '#818cf8',
                }} />
              </div>
            </div>
          )}
        </div>

        {/* Metrics row */}
        <div className="flex gap-6 mt-5 pt-5 border-t border-white/[0.06] flex-wrap">
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Total</p>
            <p className="text-lg font-bold text-gray-100 tabular-nums">{sprint.total_tasks}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Done</p>
            <p className="text-lg font-bold text-emerald-400 tabular-nums">{sprint.done_tasks}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Open</p>
            <p className="text-lg font-bold text-gray-100 tabular-nums">{sprint.open_tasks ?? (sprint.total_tasks - sprint.done_tasks)}</p>
          </div>
          {(sprint.overdue_tasks ?? 0) > 0 && (
            <div>
              <p className="text-[10px] text-red-400 uppercase tracking-wider font-medium">Overdue</p>
              <p className="text-lg font-bold text-red-400 tabular-nums">{sprint.overdue_tasks}</p>
            </div>
          )}
          {sprint.velocity !== undefined && (
            <div>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Velocity</p>
              <p className="text-lg font-bold text-indigo-400 tabular-nums">{sprint.velocity}/wk</p>
            </div>
          )}
        </div>

        {/* Goals */}
        {sprint.goals && sprint.goals.length > 0 && (
          <div className="mt-5 pt-5 border-t border-white/[0.06]">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2">Sprint Goals</p>
            <div className="space-y-1.5">
              {sprint.goals.map((g, i) => (
                <div key={i} className="flex items-center gap-2 text-[13px] text-gray-600">
                  <span className="w-1 h-1 rounded-full bg-indigo-400 shrink-0" />
                  {g}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Burndown Chart */}
      {burndown && burndown.ideal && (
        <BurndownChart ideal={burndown.ideal} actual={burndown.actual} title="Sprint Burndown" />
      )}

      {/* Sprint Activity Feed — from daily standups */}
      {activity && activity.days.length > 0 && (() => {
        const moodColors: Record<string, { bg: string; border: string; dot: string }> = {
          great: { bg: 'rgba(34,197,94,0.06)', border: 'rgba(34,197,94,0.15)', dot: '#4ade80' },
          good: { bg: 'rgba(99,102,241,0.06)', border: 'rgba(99,102,241,0.15)', dot: '#818cf8' },
          neutral: { bg: 'rgba(255,255,255,0.02)', border: 'rgba(255,255,255,0.06)', dot: '#9ca3af' },
          struggling: { bg: 'rgba(249,115,22,0.06)', border: 'rgba(249,115,22,0.15)', dot: '#fb923c' },
          blocked: { bg: 'rgba(239,68,68,0.06)', border: 'rgba(239,68,68,0.15)', dot: '#f87171' },
        };
        const moodEmoji: Record<string, string> = { great: '🟢', good: '🙂', neutral: '😐', struggling: '🟠', blocked: '🔴' };
        const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const getWeekday = (dateStr: string) => {
          try { return weekdays[new Date(dateStr).getDay()]; } catch { return ''; }
        };

        return (
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold" style={{ color: '#e5e7eb' }}>Sprint Activity</h3>
                <p className="text-[11px] mt-0.5" style={{ color: '#6b7280' }}>Daily standup data across the sprint</p>
              </div>
            </div>

            {/* Mood trend — colored pills */}
            <div className="flex items-center gap-1.5 mb-4 flex-wrap">
              <span className="text-[10px] font-medium mr-1" style={{ color: '#6b7280' }}>Mood</span>
              {activity.mood_trend.map((m) => {
                const mc = moodColors[m.mood] || moodColors.neutral;
                const hasData = m.score !== null;
                return (
                  <div key={m.date} title={`${getWeekday(m.date)} ${m.date.slice(5)}: ${hasData ? m.mood : 'no data'}`}
                    className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] cursor-default transition-all hover:scale-110"
                    style={{
                      background: hasData ? mc.bg : 'rgba(255,255,255,0.02)',
                      border: `1px solid ${hasData ? mc.border : 'rgba(255,255,255,0.04)'}`,
                    }}>
                    {hasData ? (moodEmoji[m.mood] || '·') : <span style={{ color: '#2a2a3a' }}>·</span>}
                  </div>
                );
              })}
            </div>

            {/* Daily rows */}
            <div className="space-y-1.5">
              {activity.days.filter((d) => d.posted > 0).slice(-10).map((day) => {
                const mc = moodColors[day.mood] || moodColors.neutral;
                const pct = day.total > 0 ? Math.round((day.posted / day.total) * 100) : 0;
                return (
                  <div key={day.date} className="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors"
                    style={{ background: mc.bg, border: `1px solid ${mc.border}` }}>
                    {/* Weekday + date */}
                    <div className="shrink-0" style={{ width: '72px' }}>
                      <span className="text-[11px] font-semibold" style={{ color: '#9ca3af' }}>{getWeekday(day.date)} </span>
                      <span className="text-[11px] font-mono" style={{ color: '#6b7280' }}>{day.date.slice(5)}</span>
                    </div>
                    {/* Mood */}
                    <span className="text-[13px] shrink-0">{moodEmoji[day.mood] || '😐'}</span>
                    {/* Participation bar */}
                    <div className="shrink-0 flex items-center gap-1.5" style={{ width: '70px' }}>
                      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct === 100 ? '#4ade80' : '#818cf8' }} />
                      </div>
                      <span className="text-[9px] font-medium" style={{ color: pct === 100 ? '#4ade80' : '#6b7280' }}>{day.posted}/{day.total}</span>
                    </div>
                    {/* Highlights */}
                    <span className="text-[11px] flex-1 truncate" style={{ color: '#d1d5db' }}>
                      {day.highlights.length > 0 ? day.highlights.slice(0, 2).join(' · ') : 'No highlights'}
                    </span>
                    {/* Blockers */}
                    {day.blockers > 0 && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0" style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171' }}>
                        {day.blockers} blocker{day.blockers > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Weekly Update Cards */}
      {weekGroups.map((group) => (
        <div key={group.week} className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-semibold text-gray-100">Weekly Updates</h3>
              <span className="badge badge-gray">{group.week}</span>
              <span className="text-[11px] text-gray-600">{group.updates.length} members</span>
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={() => sendUpdates('slack', group.week)}
                disabled={sending}
                className="btn btn-secondary text-[11px] py-1.5 px-3 disabled:opacity-40"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/></svg>
                Slack
              </button>
              <button
                onClick={() => sendUpdates('email', group.week)}
                disabled={sending}
                className="btn btn-secondary text-[11px] py-1.5 px-3 disabled:opacity-40"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                Email
              </button>
              <button
                onClick={() => sendUpdates('all', group.week)}
                disabled={sending}
                className="btn btn-primary text-[11px] py-1.5 px-3 disabled:opacity-40"
              >
                Send All
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {group.updates.map((u) => {
              const mood = moodConfig[u.mood] || moodConfig.neutral;
              return (
                <div key={u.id} className="card p-0 overflow-hidden">
                  {/* Card header */}
                  <div className="px-5 py-3.5 flex items-center justify-between border-b border-white/[0.04]">
                    <div className="flex items-center gap-3">
                      {(() => {
                        const ac = getAvatarColor(u.name || u.person);
                        return (
                          <div className="w-9 h-9 rounded-lg flex items-center justify-center text-[11px] font-bold shrink-0"
                            style={{ background: u.emoji ? 'rgba(255,255,255,0.03)' : ac + '20', color: u.emoji ? undefined : ac, border: u.emoji ? '1px solid rgba(255,255,255,0.06)' : `1.5px solid ${ac}35` }}>
                            {u.emoji || getInitials(u.name || u.person)}
                          </div>
                        );
                      })()}
                      <div>
                        <h4 className="text-[13px] font-semibold text-gray-100">{u.name}</h4>
                        <p className="text-[10px] text-gray-500">{u.role}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`badge ${mood.bg} ${mood.color} border ${mood.border}`}>
                        {mood.emoji} {mood.label}
                      </span>
                      {u.notified_slack && <span className="w-5 h-5 rounded-md bg-purple-50 text-purple-500 flex items-center justify-center text-[9px] font-bold" title="Sent to Slack">#</span>}
                      {u.notified_email && <span className="w-5 h-5 rounded-md bg-emerald-50 text-emerald-500 flex items-center justify-center text-[9px] font-bold" title="Emailed">@</span>}
                    </div>
                  </div>

                  {/* Card body */}
                  <div className="px-5 py-4 space-y-3">
                    <div>
                      <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Accomplished</p>
                      <p className="text-[12.5px] text-gray-600 leading-relaxed">{u.accomplished}</p>
                    </div>

                    {u.blockers && (
                      <div>
                        <p className="text-[10px] font-semibold text-red-400 uppercase tracking-wider mb-1">Blockers</p>
                        <p className="text-[12.5px] text-gray-600 leading-relaxed">{u.blockers}</p>
                      </div>
                    )}

                    {u.plan_next_week && (
                      <div>
                        <p className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider mb-1">Next Week</p>
                        <p className="text-[12.5px] text-gray-600 leading-relaxed">{u.plan_next_week}</p>
                      </div>
                    )}
                  </div>

                  {/* Timestamp */}
                  <div className="px-5 py-2 bg-white/[0.03]/60 border-t border-white/[0.04]">
                    <span className="text-[10px] text-gray-600">{u.created_at?.slice(0, 16).replace('T', ' ')}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {weekGroups.length === 0 && (
        <div className="card p-12 text-center">
          <p className="text-sm text-gray-500">No weekly updates yet.</p>
          <p className="text-[11px] text-gray-600 mt-1">Click &quot;+ Add Update&quot; to submit the first one.</p>
        </div>
      )}

      {/* Toast */}
      {sendResult && (
        <div className="toast bg-gray-900 text-white">
          {sendResult}
          <button onClick={() => setSendResult(null)} className="ml-3 text-gray-500 hover:text-white">x</button>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="modal-overlay">
          <div className="modal-panel p-6">
            <h3 className="text-base font-semibold mb-1">Add Weekly Update</h3>
            <p className="text-[11px] text-gray-500 mb-5">Submit your sprint progress for this week</p>

            <div className="space-y-4">
              <div>
                <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">Team Member</label>
                <input
                  placeholder="e.g. shivam, naveen, mansi"
                  value={newUpdate.person}
                  onChange={(e) => setNewUpdate({ ...newUpdate, person: e.target.value })}
                  className="w-full mt-1"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">Accomplished</label>
                <textarea
                  placeholder="What did you ship, fix, or complete this week?"
                  value={newUpdate.accomplished}
                  onChange={(e) => setNewUpdate({ ...newUpdate, accomplished: e.target.value })}
                  className="w-full mt-1"
                  rows={3}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">Blockers</label>
                <textarea
                  placeholder="Anything blocking you? Leave empty for none."
                  value={newUpdate.blockers}
                  onChange={(e) => setNewUpdate({ ...newUpdate, blockers: e.target.value })}
                  className="w-full mt-1"
                  rows={2}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wider">Plan Next Week</label>
                <textarea
                  placeholder="What will you focus on?"
                  value={newUpdate.plan_next_week}
                  onChange={(e) => setNewUpdate({ ...newUpdate, plan_next_week: e.target.value })}
                  className="w-full mt-1"
                  rows={2}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-2 block">Mood</label>
                <div className="flex gap-1.5">
                  {Object.entries(moodConfig).map(([key, cfg]) => (
                    <button
                      key={key}
                      onClick={() => setNewUpdate({ ...newUpdate, mood: key })}
                      className={`px-3 py-1.5 text-[12px] rounded-lg border transition-all ${
                        newUpdate.mood === key
                          ? `${cfg.bg} ${cfg.color} ${cfg.border} font-medium`
                          : 'border-gray-200 text-gray-500 hover:bg-white/[0.03]'
                      }`}
                    >
                      {cfg.emoji} {cfg.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowCreate(false)} className="btn btn-secondary text-[12px]">Cancel</button>
              <button
                onClick={createUpdate}
                disabled={!newUpdate.person || !newUpdate.accomplished}
                className="btn btn-primary text-[12px] disabled:opacity-40"
              >
                Submit Update
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
