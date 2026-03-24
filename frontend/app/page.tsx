'use client';

import { useEffect, useState } from 'react';
import StatCard from '@/components/StatCard';
import TeamMemberCard from '@/components/TeamMember';
import useWebSocket from '@/components/useWebSocket';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface PulseData {
  stats: {
    active_tasks: number;
    done_today: number;
    overdue: number;
    team_reliability: number;
  };
  team: Array<{
    slug: string;
    name: string;
    role: string;
    emoji: string;
    health: string;
    reliability: number;
    active_count: number;
    done_count: number;
    overdue_count: number;
    score: number | null;
    active_tasks: Array<{
      fu_id: string;
      what: string;
      due: string | null;
      priority: string;
      source?: string;
    }>;
    completed_items?: number;
    total_items?: number;
  }>;
  date: string;
}

interface BriefingData {
  greeting: string;
  overdue_tasks: number;
  due_today: number;
  active_tasks: number;
  at_risk_clients: number;
  sprint: { name: string; days_remaining: number; time_pct: number } | null;
  flagged_performers: Array<{ name: string; score: number }>;
}

interface Meeting {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  meet_link: string | null;
  attendees: string[];
  description: string | null;
}

export default function DashboardPage() {
  const [pulse, setPulse] = useState<PulseData | null>(null);
  const [briefing, setBriefing] = useState<BriefingData | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [standupSummary, setStandupSummary] = useState<{posted_today: number; missing_today: number; missing_names: string[]; blockers_count: number; team_mood: string; highlights: string[]; total_team: number} | null>(null);
  const [sprint, setSprint] = useState<{name: string; done_pct: number; time_pct: number; goals: string[]; elapsed_days: number; total_days: number; done_tasks: number; total_tasks: number; status: string} | null>(null);
  const [showGoals, setShowGoals] = useState(false);
  const [trends, setTrends] = useState<{active_tasks: number[]; done_today: number[]; overdue: number[]; team_reliability: number[]; data_points: number} | null>(null);
  const [clients, setClients] = useState<Array<{name: string; slug: string; health_score: number | null; phase: string | null; sentiment: string | null; contract_value: string | null}>>([]);
  const [activity, setActivity] = useState<Array<{type: string; icon: string; who: string; what: string; timestamp: string}>>([]);
  const [alerts, setAlerts] = useState<{critical: Array<{message: string; reason: string; link: string}>; warnings: Array<{message: string; reason: string; link: string}>; total: number} | null>(null);
  const [alertsExpanded, setAlertsExpanded] = useState(false);
  const [ceoSummary, setCeoSummary] = useState<{one_liner: string; all_clear: boolean; metrics: Record<string, number>} | null>(null);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [loading, setLoading] = useState(true);
  const { lastMessage, isConnected } = useWebSocket();

  const load = () => {
    Promise.all([
      fetch(`${API}/api/pulse`).then((r) => r.json()),
      fetch(`${API}/api/briefing/morning`).then((r) => r.json()),
      fetch(`${API}/api/meetings/today`).then((r) => r.json()).catch(() => []),
      fetch(`${API}/api/standups/summary`).then((r) => r.json()).catch(() => null),
      fetch(`${API}/api/pulse/trends`).then((r) => r.json()).catch(() => null),
      fetch(`${API}/api/sprint`).then((r) => r.json()).catch(() => null),
      fetch(`${API}/api/clients`).then((r) => r.json()).catch(() => []),
      fetch(`${API}/api/pulse/activity?limit=12`).then((r) => r.json()).catch(() => ({ events: [] })),
      fetch(`${API}/api/pulse/alerts`).then((r) => r.json()).catch(() => null),
      fetch(`${API}/api/pulse/ceo-summary`).then((r) => r.json()).catch(() => null),
    ]).then(([pulseData, briefingData, meetingsData, standupData, trendsData, sprintData, clientsData, activityData, alertsData, ceoData]) => {
      setPulse(pulseData);
      setBriefing(briefingData);
      setMeetings(Array.isArray(meetingsData) ? meetingsData : meetingsData.meetings || []);
      setStandupSummary(standupData);
      setTrends(trendsData);
      setSprint(sprintData?.error ? null : sprintData);
      setClients(Array.isArray(clientsData) ? clientsData : []);
      setActivity(activityData?.events || []);
      setAlerts(alertsData?.total ? alertsData : null);
      setCeoSummary(ceoData);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (lastMessage) {
      load();
    }
  }, [lastMessage]);

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    } catch {
      return iso;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-sm text-gray-500">Loading PULSE board...</div>
      </div>
    );
  }

  if (!pulse) {
    return <div className="card p-6 text-red-500 text-sm">Failed to load data. Is the backend running?</div>;
  }

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-100">PULSE Board</h2>
          <p className="text-[12px] text-gray-500 mt-0.5">{pulse.date}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-red-400'}`} />
          <span className={`text-[10px] font-medium ${isConnected ? 'text-emerald-400' : 'text-red-400'}`}>
            {isConnected ? 'Live' : 'Offline'}
          </span>
        </div>
      </div>

      {/* CEO Summary Bar */}
      {ceoSummary && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg" style={{
          background: ceoSummary.all_clear ? 'rgba(34,197,94,0.06)' : 'rgba(255,255,255,0.03)',
          border: `1px solid ${ceoSummary.all_clear ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.06)'}`,
        }}>
          {ceoSummary.all_clear ? (
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
          ) : (
            <span className="w-2 h-2 rounded-full bg-amber-400" />
          )}
          <div className="flex items-center gap-2 flex-wrap flex-1 text-[12px]">
            {ceoSummary.one_liner.split(' · ').map((part, i) => {
              const num = parseInt(part);
              let color = '#9ca3af';
              if (part.includes('overdue') || part.includes('critical') || part.includes('at-risk')) {
                color = num > 0 ? '#f87171' : '#4ade80';
              } else if (part.includes('health')) {
                const pct = parseInt(part.match(/\d+/)?.[0] || '0');
                color = pct >= 75 ? '#4ade80' : pct >= 50 ? '#facc15' : '#f87171';
              } else if (part.includes('standups')) {
                const match = part.match(/(\d+)\/(\d+)/);
                color = match && match[1] === match[2] ? '#4ade80' : '#facc15';
              } else if (part.includes('sprint')) {
                color = '#818cf8';
              } else if (part.includes('meeting')) {
                color = '#818cf8';
              }
              return (
                <span key={i}>
                  <span className="font-semibold" style={{ color }}>{part}</span>
                  {i < ceoSummary.one_liner.split(' · ').length - 1 && <span style={{ color: '#4b5563' }}> · </span>}
                </span>
              );
            })}
          </div>
          {ceoSummary.all_clear && <span className="text-[10px] font-medium" style={{ color: '#4ade80' }}>All Clear</span>}
        </div>
      )}

      {/* Alerts Banner */}
      {alerts && alerts.total > 0 && (
        <div className="card p-0 overflow-hidden" style={{
          borderColor: alerts.critical.length > 0 ? 'rgba(239,68,68,0.3)' : 'rgba(234,179,8,0.3)',
          background: alerts.critical.length > 0 ? 'rgba(239,68,68,0.06)' : 'rgba(234,179,8,0.06)',
        }}>
          <button onClick={() => setAlertsExpanded(!alertsExpanded)}
            className="w-full flex items-center justify-between px-4 py-3 transition-colors hover:bg-white/[0.02]">
            <div className="flex items-center gap-2">
              {alerts.critical.length > 0 && (
                <span className="w-2 h-2 rounded-full bg-red-500" style={{ animation: 'pulse 2s infinite' }} />
              )}
              <span className="text-[12px] font-semibold" style={{ color: alerts.critical.length > 0 ? '#f87171' : '#facc15' }}>
                {alerts.total} alert{alerts.total > 1 ? 's' : ''}
              </span>
              {alerts.critical.length > 0 && (
                <span className="badge badge-red text-[9px]">{alerts.critical.length} critical</span>
              )}
              {alerts.warnings.length > 0 && (
                <span className="badge badge-yellow text-[9px]">{alerts.warnings.length} warning{alerts.warnings.length > 1 ? 's' : ''}</span>
              )}
            </div>
            <span className="text-[10px]" style={{ color: '#6b7280', transform: alertsExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>
          </button>

          {alertsExpanded && (
            <div className="px-4 pb-3 space-y-1.5" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              {alerts.critical.map((a, i) => (
                <a key={`c-${i}`} href={a.link} className="flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors hover:bg-white/[0.03]">
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171' }}>CRITICAL</span>
                  <span className="text-[11px] flex-1" style={{ color: '#e5e7eb' }}>{a.message}</span>
                  <span className="text-[9px]" style={{ color: '#f87171' }}>{a.reason}</span>
                </a>
              ))}
              {alerts.warnings.map((a, i) => (
                <a key={`w-${i}`} href={a.link} className="flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors hover:bg-white/[0.03]">
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-bold" style={{ background: 'rgba(234,179,8,0.15)', color: '#facc15' }}>WARNING</span>
                  <span className="text-[11px] flex-1" style={{ color: '#d1d5db' }}>{a.message}</span>
                  <span className="text-[9px]" style={{ color: '#facc15' }}>{a.reason}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Morning Briefing */}
      {briefing && (
        <div className="card p-5 card">
          <p className="text-sm text-gray-600 font-medium">{briefing.greeting}</p>
          <div className="flex gap-5 mt-2 text-[12px]">
            {briefing.at_risk_clients > 0 && (
              <span className="text-orange-400 font-medium">{briefing.at_risk_clients} at-risk client{briefing.at_risk_clients > 1 ? 's' : ''}</span>
            )}
            {briefing.sprint && (
              <span className="text-indigo-400">{briefing.sprint.name}: {briefing.sprint.days_remaining}d left ({briefing.sprint.time_pct}%)</span>
            )}
            {briefing.flagged_performers.length > 0 && (
              <span className="text-red-500">
                Flagged: {briefing.flagged_performers.map((p) => `${p.name} (${p.score})`).join(', ')}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Active Tasks" value={pulse.stats.active_tasks} borderColor="blue" trend={trends?.active_tasks} trendGood="neutral" />
        <StatCard label="Done Today" value={pulse.stats.done_today} borderColor="green" trend={trends?.done_today} trendGood="up" />
        <StatCard label="Overdue" value={pulse.stats.overdue} borderColor="red" trend={trends?.overdue} trendGood="down" />
        <StatCard label="Team Health" value={`${(() => { const hv: Record<string,number> = {green:100,yellow:75,orange:50,red:25}; const s = pulse.team.map(m => hv[m.health] || 50); return s.length ? Math.round(s.reduce((a,b) => a+b, 0) / s.length) : pulse.stats.team_reliability; })()}%`} borderColor="yellow" trend={trends?.team_reliability} trendGood="up" />
      </div>

      {/* Sprint Progress Bar */}
      {sprint && sprint.status === 'active' && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <h3 className="text-[13px] font-semibold" style={{ color: '#e5e7eb' }}>{sprint.name}</h3>
              <span className={`badge text-[10px] ${sprint.done_pct >= sprint.time_pct - 10 ? 'badge-green' : 'badge-red'}`}>
                {sprint.done_pct >= sprint.time_pct - 10 ? 'On Track' : 'Behind'}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-medium tabular-nums" style={{ color: '#818cf8' }}>
                {sprint.total_days - sprint.elapsed_days}d remaining
              </span>
              <a href="/sprint" className="text-[10px] font-medium" style={{ color: '#6b7280' }}>Details →</a>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Work Done */}
            <div>
              <div className="flex justify-between text-[10px] mb-1">
                <span style={{ color: '#6b7280' }}>Work Done</span>
                <span className="font-semibold tabular-nums" style={{ color: '#e5e7eb' }}>{sprint.done_pct}%<span style={{ color: '#4b5563' }}> ({sprint.done_tasks}/{sprint.total_tasks})</span></span>
              </div>
              <div className="w-full rounded-full h-2" style={{ background: 'rgba(255,255,255,0.06)' }}>
                <div className="bg-indigo-500 h-2 rounded-full transition-all" style={{ width: `${sprint.done_pct}%` }} />
              </div>
            </div>
            {/* Time Elapsed */}
            <div>
              <div className="flex justify-between text-[10px] mb-1">
                <span style={{ color: '#6b7280' }}>Time Elapsed</span>
                <span className="font-semibold tabular-nums" style={{ color: '#e5e7eb' }}>{sprint.time_pct}%<span style={{ color: '#4b5563' }}> ({sprint.elapsed_days}/{sprint.total_days}d)</span></span>
              </div>
              <div className="w-full rounded-full h-2" style={{ background: 'rgba(255,255,255,0.06)' }}>
                <div className="h-2 rounded-full transition-all" style={{ width: `${sprint.time_pct}%`, background: '#4b5563' }} />
              </div>
            </div>
          </div>

          {/* Goals (collapsible) */}
          {sprint.goals && sprint.goals.length > 0 && (
            <div className="mt-3 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
              <button onClick={() => setShowGoals(!showGoals)} className="text-[10px] font-medium flex items-center gap-1" style={{ color: '#6b7280' }}>
                <span style={{ transform: showGoals ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', display: 'inline-block' }}>▸</span>
                {sprint.goals.length} Sprint Goals
              </button>
              {showGoals && (
                <div className="mt-2 space-y-1">
                  {sprint.goals.map((g, i) => (
                    <div key={i} className="flex items-center gap-2 text-[12px]" style={{ color: '#9ca3af' }}>
                      <span className="w-1 h-1 rounded-full bg-indigo-400 shrink-0" />
                      {g}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Client Health Strip */}
      {clients.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="section-label mb-0">Clients</p>
            <a href="/clients" className="text-[10px] font-medium" style={{ color: '#818cf8' }}>View all →</a>
          </div>
          <div className="card p-3">
            <div className="flex items-center gap-3 overflow-x-auto">
              {clients.map((c) => {
                const score = c.health_score || 0;
                const atRisk = score < 60;
                const color = score >= 80 ? '#4ade80' : score >= 60 ? '#facc15' : score >= 40 ? '#fb923c' : '#f87171';
                return (
                  <a key={c.slug} href="/clients"
                    className="flex items-center gap-2.5 px-3 py-2 rounded-lg shrink-0 transition-all hover:scale-[1.02]"
                    style={{
                      background: atRisk ? 'rgba(239,68,68,0.08)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${atRisk ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.06)'}`,
                    }}>
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 6px ${color}30` }} />
                    <div>
                      <span className="text-[12px] font-medium" style={{ color: '#e5e7eb' }}>{c.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold tabular-nums" style={{ color }}>{score}%</span>
                        {c.phase && <span className="text-[9px]" style={{ color: '#4b5563' }}>{c.phase}</span>}
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Today's Meetings */}
      {meetings.length > 0 && (
        <div>
          <p className="section-label">Today&apos;s Meetings</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
            {meetings.map((m, i) => (
              <div key={m.id || i} className="card p-4">
                <div className="flex items-start justify-between mb-2">
                  <h4 className="text-[13px] font-semibold text-gray-100 leading-snug">{m.title}</h4>
                  <span className="badge badge-blue text-[10px] shrink-0 ml-2">
                    {formatTime(m.start_time)}
                  </span>
                </div>
                {m.description && (
                  <p className="text-[11px] text-gray-500 mb-2 line-clamp-2">{m.description}</p>
                )}
                <div className="flex items-center justify-between">
                  {m.attendees && m.attendees.length > 0 && (
                    <span className="text-[10px] text-gray-500">{m.attendees.length} attendee{m.attendees.length > 1 ? 's' : ''}</span>
                  )}
                  {m.meet_link && (
                    <a href={m.meet_link} target="_blank" rel="noopener noreferrer" className="text-[11px] text-indigo-500 font-medium hover:underline">
                      Join
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Team Health Heatmap + Members */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <p className="section-label mb-0">Team</p>
          {/* Team Health Score */}
          {(() => {
            const healthValues: Record<string, number> = { green: 100, yellow: 75, orange: 50, red: 25 };
            const scores = pulse.team.map((m) => healthValues[m.health] || 50);
            const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
            const color = avg >= 75 ? '#4ade80' : avg >= 50 ? '#facc15' : avg >= 25 ? '#fb923c' : '#f87171';
            return (
              <div className="flex items-center gap-2">
                <span className="text-[11px] uppercase tracking-wider font-medium" style={{ color: '#6b7280' }}>Team Health</span>
                <span className="text-lg font-bold tabular-nums" style={{ color }}>{avg}%</span>
              </div>
            );
          })()}
        </div>

        {/* Heatmap Row */}
        <div className="card p-4 mb-4">
          <div className="flex items-center justify-center gap-4 flex-wrap">
            {pulse.team.map((m) => {
              const healthColor: Record<string, string> = { green: '#4ade80', yellow: '#facc15', orange: '#fb923c', red: '#f87171' };
              const bgColor: Record<string, string> = { green: 'rgba(34,197,94,0.15)', yellow: 'rgba(234,179,8,0.15)', orange: 'rgba(249,115,22,0.15)', red: 'rgba(239,68,68,0.15)' };
              const maxActive = Math.max(...pulse.team.map((t) => t.active_count), 1);
              const size = 28 + Math.round((m.active_count / maxActive) * 16);
              const clr = healthColor[m.health] || '#6b7280';
              const bg = bgColor[m.health] || 'rgba(255,255,255,0.05)';
              return (
                <button
                  key={m.slug}
                  onClick={() => document.getElementById(`team-${m.slug}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                  className="flex flex-col items-center gap-1.5 group transition-all"
                  title={`${m.name}: ${m.active_count} active, ${m.overdue_count} overdue`}
                >
                  <div
                    className="rounded-full flex items-center justify-center font-bold transition-transform group-hover:scale-110"
                    style={{
                      width: `${size}px`, height: `${size}px`,
                      background: bg, border: `2px solid ${clr}`,
                      color: clr, fontSize: '11px',
                      boxShadow: `0 0 ${m.overdue_count > 0 ? '8' : '4'}px ${clr}30`,
                    }}
                  >
                    {m.active_count}
                  </div>
                  <span className="text-[10px] font-medium group-hover:text-gray-300 transition-colors" style={{ color: '#6b7280' }}>
                    {m.name.split(' ')[0]}
                  </span>
                  {m.overdue_count > 0 && (
                    <span className="text-[8px] font-bold px-1 rounded" style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171' }}>
                      {m.overdue_count} overdue
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Team Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {pulse.team.map((member) => (
            <div key={member.slug} id={`team-${member.slug}`}>
              <TeamMemberCard {...member} />
            </div>
          ))}
        </div>
      </div>

      {/* Today's Standups */}
      {standupSummary && (
        <div>
          <p className="section-label">Daily Standups</p>
          {standupSummary.posted_today > 0 ? (
            <div className="card p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <span className="text-[13px] font-medium" style={{ color: '#e5e7eb' }}>
                    {standupSummary.posted_today}/{standupSummary.total_team} posted
                  </span>
                  <span className="text-[11px]" style={{ color: '#6b7280' }}>
                    Team mood: {standupSummary.team_mood}
                  </span>
                  {standupSummary.blockers_count > 0 && (
                    <span className="badge badge-red text-[10px]">{standupSummary.blockers_count} blocker{standupSummary.blockers_count > 1 ? 's' : ''}</span>
                  )}
                </div>
                <a href="/updates" className="text-[11px] font-medium" style={{ color: '#818cf8' }}>View all →</a>
              </div>
              {standupSummary.highlights.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {standupSummary.highlights.slice(0, 4).map((h, i) => (
                    <span key={i} className="text-[11px] px-2 py-1 rounded-md" style={{ background: 'rgba(255,255,255,0.04)', color: '#9ca3af' }}>{h}</span>
                  ))}
                </div>
              )}
              {standupSummary.missing_today > 0 && (
                <p className="text-[11px] mt-2" style={{ color: '#facc15' }}>
                  ⚠️ Missing: {standupSummary.missing_names.join(', ')}
                </p>
              )}
            </div>
          ) : (
            <div className="card p-4">
              <div className="flex items-center justify-between">
                <p className="text-[12px]" style={{ color: '#6b7280' }}>No standups posted yet today</p>
                <a href="/updates" className="text-[11px] font-medium" style={{ color: '#818cf8' }}>Post update →</a>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Activity Feed */}
      {activity.length > 0 && (
        <div>
          <p className="section-label">Recent Activity</p>
          <div className="card p-4">
            <div className="space-y-0.5 max-h-72 overflow-auto">
              {activity.map((e, i) => {
                // Relative time
                const ts = e.timestamp;
                let relative = ts.slice(0, 10);
                try {
                  const diff = Date.now() - new Date(ts).getTime();
                  if (diff < 60000) relative = 'just now';
                  else if (diff < 3600000) relative = `${Math.floor(diff / 60000)}m ago`;
                  else if (diff < 86400000) relative = `${Math.floor(diff / 3600000)}h ago`;
                  else if (diff < 172800000) relative = 'yesterday';
                  else relative = ts.slice(5, 10);
                } catch { /* keep date fallback */ }

                const typeColor: Record<string, string> = {
                  followup_resolved: '#4ade80',
                  task_completed: '#4ade80',
                  standup_posted: '#818cf8',
                  followup_created: '#facc15',
                  task_created: '#facc15',
                };

                return (
                  <div key={`${e.type}-${e.timestamp}-${i}`}
                    className="flex items-center gap-3 px-2 py-1.5 rounded-md transition-colors hover:bg-white/[0.02]">
                    <span className="text-sm shrink-0 w-5 text-center">{e.icon}</span>
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px]" style={{ color: '#d1d5db' }}>
                        <span className="font-medium" style={{ color: typeColor[e.type] || '#9ca3af' }}>{e.who}</span>
                        {' '}<span style={{ color: '#6b7280' }}>{e.what}</span>
                      </span>
                    </div>
                    <span className="text-[9px] tabular-nums shrink-0" style={{ color: '#4b5563' }}>{relative}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Quick Actions FAB */}
      <div className="fixed bottom-6 right-6 z-40">
        {showQuickActions && (
          <div className="mb-3 space-y-1.5" style={{ animation: 'modalIn 0.15s ease-out' }}>
            {[
              { label: 'Post Standup', icon: '📝', href: '/updates' },
              { label: 'Create Follow-up', icon: '➕', href: '/followups' },
              { label: 'Create Task', icon: '☑', href: '/taskflow' },
              { label: 'Team Comms', icon: '📡', href: '/comms' },
              { label: 'Send Reminder', icon: '🔔', action: async () => { await fetch(`${API}/api/standups/remind`, { method: 'POST' }); load(); } },
            ].map((a) => (
              <a key={a.label} href={a.href || '#'}
                onClick={(e) => { if (a.action) { e.preventDefault(); a.action(); setShowQuickActions(false); } }}
                className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-[12px] font-medium transition-all hover:scale-[1.02]"
                style={{ background: '#1a1a28', border: '1px solid rgba(255,255,255,0.08)', color: '#e5e7eb', boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}>
                <span>{a.icon}</span>
                <span>{a.label}</span>
              </a>
            ))}
          </div>
        )}
        <button onClick={() => setShowQuickActions(!showQuickActions)}
          className="w-12 h-12 rounded-full flex items-center justify-center text-lg transition-all hover:scale-110"
          style={{
            background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
            color: 'white',
            boxShadow: '0 4px 16px rgba(99,102,241,0.4)',
            transform: showQuickActions ? 'rotate(45deg)' : 'none',
          }}>
          +
        </button>
      </div>
    </div>
  );
}
