'use client';

import { useEffect, useState } from 'react';
import useWebSocket from '@/components/useWebSocket';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const EXECUTE_URL = `${API}/api/execute`;

interface Standup {
  person: string; name: string; date: string;
  done: string; doing: string; blockers: string | null;
  mood: string; highlights: string[];
  linked_tasks?: string[];
  doing_priorities?: Record<string, string>;
  created_at: string; updated_at: string;
}
interface Stats {
  posted: string[]; missing: string[]; posted_count: number; missing_count: number;
  total_team: number; team_mood: string; blockers_count: number; is_weekend: boolean;
  streaks: Record<string, number>;
}
interface Suggestion {
  fu_id: string; fu_what: string; matched_item: string;
  done_text: string; match_score: number; item_index: number;
}

const PRIORITY_KEYWORDS: Record<string, string[]> = {
  P0: ['blocker', 'blocked', 'urgent', 'critical'],
  P1: ['bug', 'hotfix', 'fix', 'broken', 'crash'],
  P2: ['review', 'pr', 'feature', 'build', 'implement', 'ship', 'deploy'],
  P3: ['research', 'explore', 'investigate', 'spike', 'prototype'],
};
const classifyPriority = (text: string): string => {
  const lower = text.toLowerCase();
  for (const [p, keywords] of Object.entries(PRIORITY_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) return p;
  }
  return 'P2';
};
const parseDoingItems = (doing: string): string[] => {
  if (!doing) return [];
  const lines = doing.split('\n').map((l) => l.replace(/^[\s\-\*•\d\.]+/, '').trim()).filter((l) => l && !['none', 'nothing', 'n/a', 'nothing specified'].includes(l.toLowerCase()));
  if (lines.length <= 1 && lines[0]) {
    const sentences = lines[0].split(/\.\s+/).map((s) => s.trim()).filter(Boolean);
    if (sentences.length > 1) return sentences.map((s) => s.replace(/\.$/, ''));
  }
  return lines;
};

const priorityColors: Record<string, { bg: string; color: string }> = {
  P0: { bg: 'rgba(239,68,68,0.15)', color: '#f87171' },
  P1: { bg: 'rgba(249,115,22,0.12)', color: '#fb923c' },
  P2: { bg: 'rgba(99,102,241,0.12)', color: '#818cf8' },
  P3: { bg: 'rgba(156,163,175,0.1)', color: '#9ca3af' },
};

const moodCfg: Record<string, { emoji: string; color: string; bg: string }> = {
  great:      { emoji: '🟢', color: '#4ade80', bg: 'rgba(34,197,94,0.08)' },
  good:       { emoji: '🙂', color: '#818cf8', bg: 'rgba(99,102,241,0.08)' },
  neutral:    { emoji: '😐', color: '#9ca3af', bg: 'rgba(255,255,255,0.03)' },
  struggling: { emoji: '🟠', color: '#fb923c', bg: 'rgba(249,115,22,0.08)' },
  blocked:    { emoji: '🔴', color: '#f87171', bg: 'rgba(239,68,68,0.08)' },
};

export default function UpdatesPage() {
  const [standups, setStandups] = useState<Standup[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [dateView, setDateView] = useState('today');
  const [showPost, setShowPost] = useState(false);
  const [posting, setPosting] = useState(false);
  const [reminding, setReminding] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [fuDetails, setFuDetails] = useState<Record<string, { checklist?: Array<{ completed: boolean }> }>>({});
  const [expandedPerson, setExpandedPerson] = useState<string | null>(null);
  const [personHistory, setPersonHistory] = useState<Standup[]>([]);
  const [newStandup, setNewStandup] = useState({ person: '', done: '', doing: '', blockers: '', mood: 'good' });
  const [gatewayConnected, setGatewayConnected] = useState<boolean | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [resolvingIdx, setResolvingIdx] = useState<number | null>(null);
  const { lastMessage } = useWebSocket();

  const getDateParam = () => {
    if (dateView === 'today') return '';
    if (dateView === 'yesterday') {
      const d = new Date(); d.setDate(d.getDate() - 1);
      return d.toISOString().slice(0, 10);
    }
    return dateView;
  };

  const load = () => {
    const dateParam = getDateParam();
    const url = dateParam ? `${API}/api/standups/${dateParam}` : `${API}/api/standups/today`;
    fetch(url).then((r) => r.json()).then((d) => setStandups(d.standups || [])).catch(() => {});
    fetch(`${API}/api/standups/stats${dateParam ? `?date=${dateParam}` : ''}`).then((r) => r.json()).then(setStats).catch(() => {});
    // Fetch FU details for progress badges
    fetch(`${API}/api/followups?source=standup`).then((r) => r.json()).then((fus) => {
      const map: Record<string, { checklist?: Array<{ completed: boolean }> }> = {};
      for (const fu of fus) if (fu.fu_id) map[fu.fu_id] = { checklist: fu.checklist };
      setFuDetails(map);
    }).catch(() => {});
  };

  useEffect(() => { load(); }, [dateView]);
  useEffect(() => { if (lastMessage?.type === 'standup_update') load(); }, [lastMessage]);
  useEffect(() => {
    fetch(`${API}/api/gateway/status`)
      .then((r) => r.json())
      .then((d) => setGatewayConnected(d.connected === true))
      .catch(() => setGatewayConnected(false));
  }, []);

  const postUpdate = async () => {
    if (!newStandup.person || !newStandup.done) return;
    setPosting(true);
    const postedPerson = newStandup.person;
    try {
      const res = await fetch(EXECUTE_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'post_standup',
          args: {
            person: newStandup.person,
            done: newStandup.done,
            doing: newStandup.doing || 'Nothing specified',
            blockers: newStandup.blockers || 'None',
            mood: newStandup.mood,
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        setShowPost(false);
        setNewStandup({ person: '', done: '', doing: '', blockers: '', mood: 'good' });
        setResult('Standup posted via OpenClaw');
        load();
        // Fetch suggestions for the posted person
        fetch(`${API}/api/standups/suggestions/${postedPerson}`)
          .then((r) => r.json())
          .then((d) => { if (d.suggestions?.length > 0) setSuggestions(d.suggestions); })
          .catch(() => {});
      } else {
        setResult(`Failed: ${data.error}`);
      }
    } catch { setResult('Failed to connect to gateway'); }
    finally { setPosting(false); setTimeout(() => setResult(null), 4000); }
  };

  const sendReminder = async () => {
    setReminding(true);
    try {
      const res = await fetch(EXECUTE_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send_standup_reminder', args: {} }),
      });
      const d = await res.json();
      setResult(d.success ? (d.result || 'Reminders sent via OpenClaw') : `Failed: ${d.error}`);
    } catch { setResult('Failed to connect to gateway'); }
    finally { setReminding(false); setTimeout(() => setResult(null), 4000); }
  };

  const resolveSuggestion = async (suggestion: Suggestion, idx: number) => {
    setResolvingIdx(idx);
    try {
      await fetch(`${API}/api/standups/resolve-suggestion`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fu_id: suggestion.fu_id, item_index: suggestion.item_index }),
      });
      setSuggestions((prev) => prev.filter((_, i) => i !== idx));
      load();
    } catch { /* ignore */ }
    finally { setResolvingIdx(null); }
  };

  const updatePriority = async (person: string, itemIndex: number, newPriority: string) => {
    await fetch(`${API}/api/standups/${person}/priorities`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priorities: { [itemIndex]: newPriority } }),
    });
    load();
  };

  const loadHistory = async (person: string) => {
    if (expandedPerson === person) { setExpandedPerson(null); return; }
    setExpandedPerson(person);
    const res = await fetch(`${API}/api/standups/person/${person}?days=14`);
    const d = await res.json();
    setPersonHistory(d.history || []);
  };

  const formatTime = (ts: string) => {
    try { return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }); }
    catch { return ''; }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold" style={{ color: '#e5e7eb' }}>Daily Updates</h2>
          <p className="text-[12px] mt-0.5" style={{ color: '#6b7280' }}>
            Team standup board — {stats ? `${stats.posted_count}/${stats.total_team} posted` : 'loading...'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {gatewayConnected !== null && (
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${gatewayConnected ? 'bg-emerald-400' : 'bg-red-400'}`}
                style={{ boxShadow: gatewayConnected ? '0 0 6px rgba(52,211,153,0.5)' : '0 0 6px rgba(248,113,113,0.5)' }}
              />
              <span className={`text-[10px] font-medium ${gatewayConnected ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
                {gatewayConnected ? 'via OpenClaw' : 'gateway offline'}
              </span>
            </div>
          )}
          <button onClick={() => setShowPost(true)} className="btn btn-primary text-[12px]">+ Post Update</button>
        </div>
      </div>

      {/* Date nav + actions */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)' }}>
          {['today', 'yesterday'].map((d) => (
            <button key={d} onClick={() => setDateView(d)}
              className="px-3 py-1.5 rounded-md text-[12px] font-medium transition-all capitalize"
              style={dateView === d ? { background: 'rgba(99,102,241,0.15)', color: '#818cf8' } : { color: '#6b7280' }}>
              {d}
            </button>
          ))}
        </div>
        {stats && stats.missing_count > 0 && !stats.is_weekend && (
          <button onClick={sendReminder} disabled={reminding} className="btn btn-secondary text-[11px] py-1.5 disabled:opacity-40">
            {reminding ? '...' : `Send Reminder (${stats.missing_count})`}
          </button>
        )}
      </div>

      {/* Resolve suggestions panel */}
      {suggestions.length > 0 && (
        <div className="card p-5" style={{ borderColor: 'rgba(99,102,241,0.2)', background: 'rgba(99,102,241,0.04)' }}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold" style={{ color: '#e5e7eb' }}>Looks like you completed these</h3>
              <p className="text-[11px] mt-0.5" style={{ color: '#6b7280' }}>Confirm to mark checklist items as done</p>
            </div>
            <button onClick={() => setSuggestions([])} className="text-[11px]" style={{ color: '#6b7280' }}>Dismiss all</button>
          </div>
          <div className="space-y-2">
            {suggestions.map((s, i) => (
              <div key={i} className="flex items-center justify-between p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex-1 min-w-0 mr-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8' }}>{s.fu_id}</span>
                    <span className="text-[11px]" style={{ color: '#d1d5db' }}>{s.matched_item}</span>
                  </div>
                  <p className="text-[10px] mt-1" style={{ color: '#6b7280' }}>
                    You said: &quot;{s.done_text}&quot; — {Math.round(s.match_score * 100)}% match
                  </p>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button onClick={() => setSuggestions((prev) => prev.filter((_, j) => j !== i))}
                    className="text-[10px] px-2 py-1 rounded" style={{ color: '#6b7280' }}>Skip</button>
                  <button onClick={() => resolveSuggestion(s, i)} disabled={resolvingIdx === i}
                    className="text-[10px] px-2.5 py-1 rounded font-medium disabled:opacity-40"
                    style={{ background: 'rgba(34,197,94,0.15)', color: '#4ade80' }}>
                    {resolvingIdx === i ? '...' : 'Resolve'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Missing alert */}
      {stats && stats.missing_count > 0 && !stats.is_weekend && (
        <div className="card p-4" style={{ borderColor: 'rgba(234,179,8,0.2)', background: 'rgba(234,179,8,0.05)' }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[12px] font-medium" style={{ color: '#facc15' }}>
                Missing today: {stats.missing.join(', ')}
              </p>
            </div>
            {stats.blockers_count > 0 && (
              <span className="badge badge-red text-[10px]">{stats.blockers_count} blocker{stats.blockers_count > 1 ? 's' : ''}</span>
            )}
          </div>
        </div>
      )}

      {stats && stats.posted_count === stats.total_team && stats.total_team > 0 && (
        <div className="card p-3 text-center" style={{ borderColor: 'rgba(34,197,94,0.2)', background: 'rgba(34,197,94,0.05)' }}>
          <p className="text-[12px] font-medium" style={{ color: '#4ade80' }}>All {stats.total_team} team members have posted</p>
        </div>
      )}

      {/* Standup cards */}
      {standups.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {standups.map((s) => {
            const mood = moodCfg[s.mood] || moodCfg.neutral;
            const streak = stats?.streaks?.[s.person] || 0;
            const doingItems = parseDoingItems(s.doing);
            const linkedFUs = (s.linked_tasks || []).filter((id) => id.startsWith('FU-'));
            const linkedTasks = (s.linked_tasks || []).filter((id) => id.startsWith('TF-'));
            return (
              <div key={s.person} className="card p-0 overflow-hidden cursor-pointer" onClick={() => loadHistory(s.person)}>
                {/* Header with mood */}
                <div className="px-5 py-3 flex items-center justify-between" style={{ background: mood.bg, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{mood.emoji}</span>
                    <div>
                      <h4 className="text-[13px] font-semibold" style={{ color: '#e5e7eb' }}>{s.name || s.person}</h4>
                      <p className="text-[10px]" style={{ color: '#6b7280' }}>{formatTime(s.created_at)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {streak > 1 && <span className="badge badge-blue text-[9px]">{streak}d streak</span>}
                    <span className="text-[10px] font-medium" style={{ color: mood.color }}>{s.mood}</span>
                  </div>
                </div>

                {/* Body */}
                <div className="px-5 py-4 space-y-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: '#4ade80' }}>Done</p>
                    <p className="text-[12px] leading-relaxed" style={{ color: '#d1d5db' }}>{s.done}</p>
                  </div>
                  {s.doing && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#818cf8' }}>Doing</p>
                      <div className="space-y-1">
                        {doingItems.map((item, idx) => {
                          const pri = s.doing_priorities?.[String(idx)] || classifyPriority(item);
                          const pc = priorityColors[pri] || priorityColors.P2;
                          return (
                            <div key={idx} className="flex items-start gap-2">
                              <select
                                value={pri}
                                onChange={(e) => { e.stopPropagation(); updatePriority(s.person, idx, e.target.value); }}
                                onClick={(e) => e.stopPropagation()}
                                className="text-[9px] font-medium rounded px-1 py-0.5 shrink-0 cursor-pointer border-0"
                                style={{ background: pc.bg, color: pc.color, appearance: 'none', WebkitAppearance: 'none', width: '28px', textAlign: 'center' }}
                              >
                                {['P0', 'P1', 'P2', 'P3'].map((p) => <option key={p} value={p}>{p}</option>)}
                              </select>
                              <p className="text-[12px] leading-relaxed" style={{ color: '#d1d5db' }}>{item}</p>
                            </div>
                          );
                        })}
                      </div>

                      {/* Linked FU/Task badges */}
                      {(linkedFUs.length > 0 || linkedTasks.length > 0) && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {linkedFUs.map((id) => {
                            const fu = fuDetails[id];
                            const cl = fu?.checklist || [];
                            const done = cl.filter((c) => c.completed).length;
                            const total = cl.length;
                            return (
                              <a key={id} href="/followups" onClick={(e) => e.stopPropagation()}
                                className="text-[9px] font-mono px-1.5 py-0.5 rounded transition-opacity hover:opacity-80"
                                style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8' }}>
                                {id}{total > 0 && <span className="opacity-60 ml-0.5">({done}/{total})</span>}
                              </a>
                            );
                          })}
                          {linkedTasks.map((id) => (
                            <a key={id} href="/taskflow" onClick={(e) => e.stopPropagation()}
                              className="text-[9px] font-mono px-1.5 py-0.5 rounded transition-opacity hover:opacity-80"
                              style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}>{id}</a>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {s.blockers && (
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: '#f87171' }}>Blockers</p>
                      <p className="text-[12px] leading-relaxed" style={{ color: '#d1d5db' }}>{s.blockers}</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card p-12 text-center">
          <p className="text-sm" style={{ color: '#6b7280' }}>No standups posted {dateView === 'today' ? 'yet today' : 'for this date'}</p>
          <p className="text-[11px] mt-1" style={{ color: '#4b5563' }}>Click &quot;+ Post Update&quot; to get started</p>
        </div>
      )}

      {/* Person history (expanded) */}
      {expandedPerson && personHistory.length > 0 && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold" style={{ color: '#e5e7eb' }}>
              {expandedPerson} — Last {personHistory.length} days
            </h3>
            <button onClick={() => setExpandedPerson(null)} className="text-[11px]" style={{ color: '#6b7280' }}>Close</button>
          </div>
          <div className="space-y-2">
            {personHistory.map((h) => {
              const m = moodCfg[h.mood] || moodCfg.neutral;
              return (
                <div key={h.date} className="flex gap-3 p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <div className="shrink-0 text-center" style={{ width: '60px' }}>
                    <p className="text-[11px] font-mono" style={{ color: '#9ca3af' }}>{h.date.slice(5)}</p>
                    <span className="text-sm">{m.emoji}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px]" style={{ color: '#d1d5db' }}>{h.done}</p>
                    {h.blockers && <p className="text-[11px] mt-1" style={{ color: '#f87171' }}>Blocker: {h.blockers}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Post modal */}
      {showPost && (
        <div className="modal-overlay">
          <div className="modal-panel p-6">
            <h3 className="text-base font-semibold mb-1" style={{ color: '#e5e7eb' }}>Post Daily Update</h3>
            <p className="text-[11px] mb-4" style={{ color: '#6b7280' }}>Share what you did, what you&apos;re doing, and any blockers</p>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>Who *</label>
                <select value={newStandup.person} onChange={(e) => setNewStandup({ ...newStandup, person: e.target.value })} className="w-full mt-1">
                  <option value="">Select team member</option>
                  {(stats?.posted ? [...stats.missing, ...stats.posted] : []).sort().map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#4ade80' }}>What did you accomplish? *</label>
                <textarea placeholder="Shipped feature X. Fixed 3 bugs. Reviewed PR #42..." value={newStandup.done}
                  onChange={(e) => setNewStandup({ ...newStandup, done: e.target.value })} className="w-full mt-1" rows={3} />
              </div>
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#818cf8' }}>What are you working on?</label>
                <textarea placeholder="Starting CI/CD pipeline. Writing docs..." value={newStandup.doing}
                  onChange={(e) => setNewStandup({ ...newStandup, doing: e.target.value })} className="w-full mt-1" rows={2} />
              </div>
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#f87171' }}>Blockers</label>
                <textarea placeholder="None" value={newStandup.blockers}
                  onChange={(e) => setNewStandup({ ...newStandup, blockers: e.target.value })} className="w-full mt-1" rows={2} />
              </div>
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wider mb-2 block" style={{ color: '#6b7280' }}>Mood</label>
                <div className="flex gap-1.5">
                  {Object.entries(moodCfg).map(([key, cfg]) => (
                    <button key={key} onClick={() => setNewStandup({ ...newStandup, mood: key })}
                      className="px-3 py-1.5 text-[12px] rounded-lg border transition-all capitalize"
                      style={newStandup.mood === key
                        ? { background: cfg.bg, color: cfg.color, borderColor: cfg.color + '40' }
                        : { borderColor: 'rgba(255,255,255,0.08)', color: '#6b7280' }
                      }>
                      {cfg.emoji} {key}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {gatewayConnected === false && (
              <p className="text-[11px] mt-2" style={{ color: '#f87171' }}>
                OpenClaw gateway is offline. Posting is temporarily unavailable.
              </p>
            )}

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowPost(false)} className="btn btn-secondary text-[12px]">Cancel</button>
              <button onClick={postUpdate} disabled={posting || !newStandup.person || !newStandup.done || gatewayConnected === false}
                className="btn btn-primary text-[12px] disabled:opacity-40">
                {posting ? 'Posting via OpenClaw...' : 'Post Update'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {result && (
        <div className={`toast ${result.includes('Failed') ? '!bg-red-600' : ''}`}>
          {result}
          <button onClick={() => setResult(null)} className="ml-3 opacity-60 hover:opacity-100">x</button>
        </div>
      )}
    </div>
  );
}
