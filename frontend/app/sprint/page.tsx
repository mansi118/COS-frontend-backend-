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
  done_pct: number;
  time_pct: number;
  elapsed_days: number;
  total_days: number;
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
  const [showCreate, setShowCreate] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [newUpdate, setNewUpdate] = useState({
    person: '', accomplished: '', blockers: '', plan_next_week: '', mood: 'good',
  });
  const { lastMessage } = useWebSocket();

  const load = () => {
    fetch(`${API}/api/sprint`).then((r) => r.json()).then(setSprint);
    fetch(`${API}/api/sprint/burndown`).then((r) => r.json()).then(setBurndown);
    fetch(`${API}/api/sprint/updates/by-week`).then((r) => r.json()).then((d) => setWeekGroups(d.weeks || []));
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
        <button onClick={() => setShowCreate(true)} className="btn btn-primary text-[12px]">
          + Add Update
        </button>
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
        </div>

        {/* Metrics row */}
        <div className="flex gap-8 mt-5 pt-5 border-t border-white/[0.06]">
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Total</p>
            <p className="text-lg font-bold text-gray-100 tabular-nums">{sprint.total_tasks}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Done</p>
            <p className="text-lg font-bold text-emerald-400 tabular-nums">{sprint.done_tasks}</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">Remaining</p>
            <p className="text-lg font-bold text-gray-100 tabular-nums">{sprint.total_tasks - sprint.done_tasks}</p>
          </div>
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
                      <div className="w-9 h-9 rounded-lg bg-white/[0.03] border border-white/[0.06] flex items-center justify-center text-lg">
                        {u.emoji}
                      </div>
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
