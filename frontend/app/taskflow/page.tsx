'use client';

import { useEffect, useState } from 'react';
import useWebSocket from '@/components/useWebSocket';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface Task {
  id: string;
  title: string;
  notes?: string;
  status: string;
  when_date?: string | null;
  deadline?: string | null;
  due?: string | null;
  priority?: string;
  priority_hint?: string;
  assigned_to?: string;
  owner?: string;
  project_id?: string;
  project_name?: string;
  tags?: string[];
  is_today?: boolean;
  checklist_items?: Array<{ title: string; is_completed?: boolean }>;
  source?: string;
  created?: string;
}

interface Summary {
  overdue: number;
  due_today: number;
  completed_today: number;
  inbox: number;
  total_active: number;
}

interface Project {
  id: string;
  name: string;
  color: string;
  status: string;
  task_count?: number;
  completed_count?: number;
}

const VIEWS = [
  { key: 'today', label: 'Today', icon: '☀' },
  { key: 'inbox', label: 'Inbox', icon: '↓' },
  { key: 'upcoming', label: 'Upcoming', icon: '▸' },
  { key: 'anytime', label: 'Anytime', icon: '∞' },
  { key: 'someday', label: 'Someday', icon: '☁' },
  { key: 'logbook', label: 'Logbook', icon: '✓' },
  { key: 'trash', label: 'Trash', icon: '⌫' },
];

interface TeamHealth {
  health_score: number; total_active: number; overdue: number; approaching_deadline: number;
  inbox: number; completed_this_week: number; created_this_week: number; velocity: number; completion_rate: number;
}
interface WorkloadItem { person: string; task_count: number; overdue_count: number; today_count: number; weighted_score: number; }
interface RiskFlag { project_id: string; project_name: string; risk_level: string; reasons: string[]; }
interface OverdueItem { task_id: string; title: string; deadline: string; overdue_days: number; project: string; }
interface BriefingItem { id: string; title: string; assignee?: string; deadline?: string; overdue_days?: number; days_until?: number; }
interface Briefing { date: string; overdue: BriefingItem[]; today: BriefingItem[]; approaching: BriefingItem[]; completed_yesterday: number; inbox_count: number; total_active: number; }

export default function TaskFlowPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeView, setActiveView] = useState('today');
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<{ mode: string } | null>(null);
  const [mainTab, setMainTab] = useState<'tasks' | 'analytics' | 'briefing'>('tasks');
  const [health, setHealth] = useState<TeamHealth | null>(null);
  const [workload, setWorkload] = useState<WorkloadItem[]>([]);
  const [risks, setRisks] = useState<{ project_risks: RiskFlag[]; overdue_tasks: OverdueItem[] }>({ project_risks: [], overdue_tasks: [] });
  const [velocity, setVelocity] = useState<{ velocity: number; net_velocity: number; completed: number; created: number } | null>(null);
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [notifyResult, setNotifyResult] = useState<string | null>(null);
  const [notifying, setNotifying] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', notes: '', when_date: '', deadline: '', project_id: '', priority_hint: '', tags: '', owner: '' });
  const { lastMessage } = useWebSocket();

  const loadAnalytics = () => {
    Promise.all([
      fetch(`${API}/api/taskflow/analytics/team-health`).then((r) => r.json()),
      fetch(`${API}/api/taskflow/analytics/workload`).then((r) => r.json()),
      fetch(`${API}/api/taskflow/analytics/risk-flags`).then((r) => r.json()),
      fetch(`${API}/api/taskflow/analytics/velocity?period=7d`).then((r) => r.json()),
    ]).then(([h, w, r, v]) => {
      setHealth(h); setWorkload(w.workload || []); setRisks(r); setVelocity(v);
    }).catch(() => {});
  };

  const loadBriefing = () => {
    fetch(`${API}/api/taskflow/briefing/daily`).then((r) => r.json()).then(setBriefing).catch(() => {});
  };

  const sendNotify = async (type: 'briefing' | 'overdue') => {
    setNotifying(true); setNotifyResult(null);
    try {
      const res = await fetch(`${API}/api/taskflow/notify/${type}`, { method: 'POST' });
      const data = await res.json();
      setNotifyResult(data.sent ? `Sent to ${data.sent} recipient(s)` : data.error || 'No emails sent');
    } catch { setNotifyResult('Failed'); }
    finally { setNotifying(false); setTimeout(() => setNotifyResult(null), 4000); }
  };

  const load = () => {
    setLoading(true);
    Promise.all([
      fetch(`${API}/api/taskflow/tasks?view=${activeView}`).then((r) => r.json()),
      fetch(`${API}/api/taskflow/summary`).then((r) => r.json()),
      fetch(`${API}/api/taskflow/projects`).then((r) => r.json()),
      fetch(`${API}/api/taskflow/config`).then((r) => r.json()),
    ]).then(([taskData, summaryData, projData, configData]) => {
      setTasks(taskData.tasks || []);
      setSummary(summaryData);
      setProjects(projData.projects || []);
      setConfig(configData);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, [activeView]);

  useEffect(() => {
    if (mainTab === 'analytics') loadAnalytics();
    if (mainTab === 'briefing') loadBriefing();
  }, [mainTab]);

  useEffect(() => {
    if (lastMessage?.type === 'task_update') { load(); if (mainTab === 'analytics') loadAnalytics(); if (mainTab === 'briefing') loadBriefing(); }
  }, [lastMessage]);

  const completeTask = async (id: string) => {
    await fetch(`${API}/api/taskflow/tasks/${id}/complete`, { method: 'POST' });
    load();
  };

  const trashTask = async (id: string) => {
    await fetch(`${API}/api/taskflow/tasks/${id}/trash`, { method: 'POST' });
    load();
  };

  const restoreTask = async (id: string) => {
    await fetch(`${API}/api/taskflow/tasks/${id}/restore`, { method: 'POST' });
    load();
  };

  const uncompleteTask = async (id: string) => {
    await fetch(`${API}/api/taskflow/tasks/${id}/uncomplete`, { method: 'POST' });
    load();
  };

  const createTask = async () => {
    if (!newTask.title) return;
    await fetch(`${API}/api/taskflow/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...newTask,
        when_date: newTask.when_date || null,
        deadline: newTask.deadline || null,
        project_id: newTask.project_id || null,
        tags: newTask.tags ? newTask.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
        owner: newTask.owner || null,
      }),
    });
    setShowCreate(false);
    setNewTask({ title: '', notes: '', when_date: '', deadline: '', project_id: '', priority_hint: '', tags: '', owner: '' });
    load();
  };

  const today = new Date().toISOString().slice(0, 10);

  const getTaskDue = (t: Task) => t.when_date || t.deadline || t.due || null;
  const isOverdue = (t: Task) => {
    const d = getTaskDue(t);
    return d && d < today && t.status !== 'completed';
  };

  const getPriority = (t: Task) => t.priority || t.priority_hint || '';
  const getAssignee = (t: Task) => t.assigned_to || t.owner || '';
  const isCompleted = (t: Task) => t.status === 'completed' || t.status === 'resolved' || t.status === 'done';
  const isTrashed = (t: Task) => t.status === 'trashed';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold" style={{ color: '#e5e7eb' }}>TaskFlow</h2>
          <p className="text-[12px] mt-0.5" style={{ color: '#6b7280' }}>
            Task manager — {config?.mode === 'api' ? 'connected to TaskFlow API' : 'local mode'}
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn btn-primary text-[12px]">+ New Task</button>
      </div>

      {/* Primary Tabs */}
      <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)' }}>
        {(['tasks', 'analytics', 'briefing'] as const).map((t) => (
          <button key={t} onClick={() => setMainTab(t)}
            className="px-4 py-1.5 rounded-md text-[12px] font-medium transition-all capitalize"
            style={mainTab === t ? { background: 'rgba(99,102,241,0.15)', color: '#818cf8' } : { color: '#6b7280' }}>
            {t}
          </button>
        ))}
      </div>

      {/* Summary Stats */}
      {mainTab === 'tasks' && summary && (
        <div className="grid grid-cols-5 gap-3">
          {[
            { label: 'Overdue', value: summary.overdue, border: 'stat-red' },
            { label: 'Due Today', value: summary.due_today, border: 'stat-blue' },
            { label: 'Completed', value: summary.completed_today, border: 'stat-green' },
            { label: 'Inbox', value: summary.inbox, border: 'stat-yellow' },
            { label: 'Active', value: summary.total_active, border: 'stat-blue' },
          ].map((s) => (
            <div key={s.label} className={`card p-4 ${s.border}`}>
              <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>{s.label}</p>
              <p className="text-xl font-bold tabular-nums mt-0.5" style={{ color: '#e5e7eb' }}>{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* View Tabs */}
      {mainTab === 'tasks' && <div className="flex gap-1 p-1 rounded-lg overflow-x-auto" style={{ background: 'rgba(255,255,255,0.04)' }}>
        {VIEWS.map((v) => (
          <button key={v.key} onClick={() => setActiveView(v.key)}
            className="px-3 py-1.5 rounded-md text-[12px] font-medium transition-all whitespace-nowrap flex items-center gap-1.5 shrink-0"
            style={activeView === v.key
              ? { background: 'rgba(99,102,241,0.15)', color: '#818cf8' }
              : { color: '#6b7280' }
            }>
            <span className="text-[11px]">{v.icon}</span> {v.label}
          </button>
        ))}
      </div>}

      {/* Tasks Content */}
      {mainTab === 'tasks' && <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        {/* Task List */}
        <div className="xl:col-span-3 space-y-1.5">
          {loading ? (
            <div className="card p-8 text-center"><p className="text-sm" style={{ color: '#6b7280' }}>Loading...</p></div>
          ) : tasks.length === 0 ? (
            <div className="card p-12 text-center">
              <p className="text-sm" style={{ color: '#6b7280' }}>No tasks in {activeView} view</p>
              <p className="text-[11px] mt-1" style={{ color: '#4b5563' }}>Create a task or switch views</p>
            </div>
          ) : (
            tasks.map((t) => {
              const due = getTaskDue(t);
              const overdue = isOverdue(t);
              const completed = isCompleted(t);
              const trashed = isTrashed(t);
              const pri = getPriority(t);
              const assignee = getAssignee(t);
              const checklistTotal = (t.checklist_items || []).length;
              const checklistDone = (t.checklist_items || []).filter((c) => c.is_completed).length;

              return (
                <div key={t.id} className={`card p-0 overflow-hidden ${overdue ? 'border-l-2 border-l-red-500/50' : ''}`}>
                  <div className="flex items-start gap-3 px-4 py-3">
                    {/* Checkbox / Action */}
                    <div className="pt-0.5 shrink-0">
                      {trashed ? (
                        <button onClick={() => restoreTask(t.id)} className="w-5 h-5 rounded-full border flex items-center justify-center text-[10px] transition-colors"
                          style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#818cf8' }} title="Restore">↩</button>
                      ) : completed ? (
                        <button onClick={() => uncompleteTask(t.id)} className="w-5 h-5 rounded-full flex items-center justify-center text-[10px]"
                          style={{ background: 'rgba(34,197,94,0.2)', color: '#4ade80' }} title="Uncomplete">✓</button>
                      ) : (
                        <button onClick={() => completeTask(t.id)} className="w-5 h-5 rounded-full border transition-colors hover:bg-emerald-500/10 hover:border-emerald-500/30"
                          style={{ borderColor: 'rgba(255,255,255,0.12)' }} title="Complete" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-[13px] leading-snug ${completed ? 'line-through' : ''}`}
                        style={{ color: completed ? '#4b5563' : '#e5e7eb' }}>
                        {t.title}
                      </p>

                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className="text-[9px] font-mono" style={{ color: '#4b5563' }}>{t.id}</span>

                        {t.source === 'standup' && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-medium" style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8' }}>Standup</span>
                        )}
                        {t.source === 'meeting' && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-medium" style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}>Meeting</span>
                        )}

                        {assignee && <span className="badge badge-gray text-[9px]">{assignee}</span>}

                        {t.project_name && <span className="badge badge-purple text-[9px]">{t.project_name}</span>}

                        {pri && <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-medium priority-${pri}`}>{pri}</span>}

                        {t.status && t.status !== 'active' && t.status !== 'completed' && t.status !== 'trashed' && (
                          <span className={`badge text-[9px] ${t.status === 'blocked' ? 'badge-red' : t.status === 'todo' ? 'badge-yellow' : 'badge-gray'}`}>{t.status}</span>
                        )}

                        {(t.tags || [])
                          .filter((tag) => !tag.startsWith('standup') && !tag.startsWith('meeting') && !tag.match(/^\d{4}-/))
                          .map((tag) => (
                          <span key={tag} className="badge badge-gray text-[9px]">{tag}</span>
                        ))}

                        {due && (
                          <span className="text-[10px]" style={{ color: overdue ? '#f87171' : due === today ? '#facc15' : '#6b7280' }}>
                            {overdue ? 'Overdue: ' : due === today ? 'Today' : ''}{due !== today ? due : ''}
                          </span>
                        )}

                        {checklistTotal > 0 && (
                          <span className="text-[10px]" style={{ color: checklistDone === checklistTotal ? '#4ade80' : '#6b7280' }}>
                            {checklistDone}/{checklistTotal}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Trash button */}
                    {!trashed && !completed && (
                      <button onClick={() => trashTask(t.id)} className="text-[11px] px-2 py-1 rounded transition-colors shrink-0"
                        style={{ color: '#4b5563' }} title="Trash">⌫</button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Projects Sidebar */}
        <div className="space-y-4">
          <div className="card p-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider mb-3" style={{ color: '#6b7280' }}>Projects</h3>
            <div className="space-y-1">
              {projects.map((p) => (
                <div key={p.id} className="flex items-center justify-between px-2 py-1.5 rounded-md" style={{ background: 'rgba(255,255,255,0.02)' }}>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                    <span className="text-[12px]" style={{ color: '#d1d5db' }}>{p.name}</span>
                  </div>
                  <span className="text-[10px] tabular-nums" style={{ color: '#4b5563' }}>{p.task_count || 0}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Config */}
          {config && (
            <div className="card p-4">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: '#6b7280' }}>Status</h3>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${config.mode === 'api' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                <span className="text-[11px]" style={{ color: '#9ca3af' }}>
                  {config.mode === 'api' ? 'TaskFlow API' : 'Local JSON'}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>}

      {/* Analytics Tab */}
      {mainTab === 'analytics' && (
        <div className="space-y-6">
          {/* Team Health */}
          {health && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: 'Health Score', value: `${health.health_score}/100`, border: health.health_score >= 70 ? 'stat-green' : health.health_score >= 40 ? 'stat-yellow' : 'stat-red' },
                { label: 'Velocity', value: `${health.velocity}/day`, border: 'stat-blue' },
                { label: 'Completion Rate', value: `${health.completion_rate}%`, border: 'stat-green' },
                { label: 'Approaching', value: String(health.approaching_deadline), border: 'stat-yellow' },
              ].map((s) => (
                <div key={s.label} className={`card p-4 ${s.border}`}>
                  <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>{s.label}</p>
                  <p className="text-xl font-bold tabular-nums mt-0.5" style={{ color: '#e5e7eb' }}>{s.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Workload Table */}
          {workload.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-5 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <h3 className="text-sm font-semibold" style={{ color: '#e5e7eb' }}>Workload Scores</h3>
              </div>
              <table className="w-full text-[13px]">
                <thead>
                  <tr>
                    {['Person', 'Tasks', 'Overdue', 'Today', 'Score'].map((h) => (
                      <th key={h} className="text-left px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#6b7280' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {workload.map((w) => (
                    <tr key={w.person}>
                      <td className="px-5 py-2.5 font-medium" style={{ color: '#e5e7eb' }}>{w.person}</td>
                      <td className="px-5 py-2.5 tabular-nums" style={{ color: '#9ca3af' }}>{w.task_count}</td>
                      <td className="px-5 py-2.5">{w.overdue_count > 0 ? <span className="badge badge-red">{w.overdue_count}</span> : <span style={{ color: '#6b7280' }}>0</span>}</td>
                      <td className="px-5 py-2.5 tabular-nums" style={{ color: '#9ca3af' }}>{w.today_count}</td>
                      <td className="px-5 py-2.5 font-bold tabular-nums" style={{ color: w.weighted_score > 10 ? '#f87171' : w.weighted_score > 5 ? '#facc15' : '#4ade80' }}>{w.weighted_score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Risk Flags */}
          {risks.project_risks.length > 0 && (
            <div>
              <p className="section-label">Project Risks</p>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {risks.project_risks.map((r) => (
                  <div key={r.project_id} className={`card p-4 ${r.risk_level === 'high' ? 'border-l-2 border-l-red-500/50' : r.risk_level === 'medium' ? 'border-l-2 border-l-yellow-500/50' : ''}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[13px] font-medium" style={{ color: '#e5e7eb' }}>{r.project_name}</span>
                      <span className={`badge text-[10px] ${r.risk_level === 'high' ? 'badge-red' : r.risk_level === 'medium' ? 'badge-yellow' : 'badge-green'}`}>{r.risk_level}</span>
                    </div>
                    {r.reasons.map((reason, i) => (
                      <p key={i} className="text-[11px]" style={{ color: '#9ca3af' }}>{reason}</p>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Overdue Tasks */}
          {risks.overdue_tasks.length > 0 && (
            <div>
              <p className="section-label">Overdue Tasks ({risks.overdue_tasks.length})</p>
              <div className="space-y-1.5">
                {risks.overdue_tasks.map((t) => (
                  <div key={t.task_id} className="card p-3 border-l-2 border-l-red-500/50">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px]" style={{ color: '#e5e7eb' }}>{t.title}</span>
                      <span className="text-[11px]" style={{ color: '#f87171' }}>{t.overdue_days}d overdue</span>
                    </div>
                    <span className="text-[10px]" style={{ color: '#6b7280' }}>{t.task_id} · {t.deadline}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Velocity */}
          {velocity && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold mb-3" style={{ color: '#e5e7eb' }}>Velocity (7d)</h3>
              <div className="grid grid-cols-3 gap-4">
                <div><p className="text-[10px] uppercase tracking-wider" style={{ color: '#6b7280' }}>Completed</p><p className="text-lg font-bold" style={{ color: '#4ade80' }}>{velocity.completed}</p></div>
                <div><p className="text-[10px] uppercase tracking-wider" style={{ color: '#6b7280' }}>Created</p><p className="text-lg font-bold" style={{ color: '#818cf8' }}>{velocity.created}</p></div>
                <div><p className="text-[10px] uppercase tracking-wider" style={{ color: '#6b7280' }}>Net Velocity</p><p className="text-lg font-bold" style={{ color: velocity.net_velocity >= 0 ? '#4ade80' : '#f87171' }}>{velocity.net_velocity}/day</p></div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Briefing Tab */}
      {mainTab === 'briefing' && (
        <div className="space-y-6">
          {/* Actions */}
          <div className="flex gap-2">
            <button onClick={() => sendNotify('briefing')} disabled={notifying} className="btn btn-primary text-[12px] disabled:opacity-40">
              {notifying ? 'Sending...' : 'Send Briefing to Team'}
            </button>
            <button onClick={() => sendNotify('overdue')} disabled={notifying} className="btn btn-secondary text-[12px] disabled:opacity-40">
              Send Overdue Alerts
            </button>
          </div>

          {briefing ? (
            <>
              {/* Overdue */}
              {briefing.overdue.length > 0 && (
                <div>
                  <p className="section-label" style={{ color: '#f87171' }}>Overdue ({briefing.overdue.length})</p>
                  <div className="space-y-1.5">
                    {briefing.overdue.map((t) => (
                      <div key={t.id} className="card p-3 border-l-2 border-l-red-500/50">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-[13px] font-medium" style={{ color: '#e5e7eb' }}>{t.title}</span>
                            {t.assignee && <span className="badge badge-gray text-[9px] ml-2">{t.assignee}</span>}
                          </div>
                          <span className="text-[11px] font-medium" style={{ color: '#f87171' }}>{t.overdue_days}d overdue</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Today */}
              {briefing.today.length > 0 && (
                <div>
                  <p className="section-label">Today ({briefing.today.length})</p>
                  <div className="space-y-1.5">
                    {briefing.today.map((t) => (
                      <div key={t.id} className="card p-3">
                        <span className="text-[13px]" style={{ color: '#e5e7eb' }}>{t.title}</span>
                        {t.assignee && <span className="badge badge-gray text-[9px] ml-2">{t.assignee}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Approaching */}
              {briefing.approaching.length > 0 && (
                <div>
                  <p className="section-label" style={{ color: '#facc15' }}>Approaching Deadlines ({briefing.approaching.length})</p>
                  <div className="space-y-1.5">
                    {briefing.approaching.map((t) => (
                      <div key={t.id} className="card p-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="text-[13px]" style={{ color: '#e5e7eb' }}>{t.title}</span>
                            {t.assignee && <span className="badge badge-gray text-[9px] ml-2">{t.assignee}</span>}
                          </div>
                          <span className="text-[11px]" style={{ color: '#facc15' }}>{t.days_until}d</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Stats */}
              <div className="flex gap-6 text-[12px] pt-2" style={{ color: '#6b7280' }}>
                <span>Completed yesterday: <strong style={{ color: '#4ade80' }}>{briefing.completed_yesterday}</strong></span>
                <span>Inbox: <strong>{briefing.inbox_count}</strong></span>
                <span>Active: <strong>{briefing.total_active}</strong></span>
              </div>
            </>
          ) : (
            <div className="card p-8 text-center">
              <p className="text-sm" style={{ color: '#6b7280' }}>Loading briefing data...</p>
            </div>
          )}
        </div>
      )}

      {/* Notify Toast */}
      {notifyResult && (
        <div className={`toast ${notifyResult.includes('Failed') ? '!bg-red-600' : ''}`}>
          {notifyResult}
          <button onClick={() => setNotifyResult(null)} className="ml-3 opacity-60 hover:opacity-100">x</button>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="modal-overlay">
          <div className="modal-panel p-6">
            <h3 className="text-base font-semibold mb-1" style={{ color: '#e5e7eb' }}>New Task</h3>
            <p className="text-[11px] mb-4" style={{ color: '#6b7280' }}>Create a task in TaskFlow</p>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>Title *</label>
                <input placeholder="What needs to be done?" value={newTask.title}
                  onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} className="w-full mt-1" />
              </div>
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>Notes</label>
                <textarea placeholder="Details..." value={newTask.notes}
                  onChange={(e) => setNewTask({ ...newTask, notes: e.target.value })} className="w-full mt-1" rows={3} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>When</label>
                  <input type="date" value={newTask.when_date}
                    onChange={(e) => setNewTask({ ...newTask, when_date: e.target.value })} className="w-full mt-1" />
                </div>
                <div>
                  <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>Deadline</label>
                  <input type="date" value={newTask.deadline}
                    onChange={(e) => setNewTask({ ...newTask, deadline: e.target.value })} className="w-full mt-1" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>Project</label>
                  <select value={newTask.project_id}
                    onChange={(e) => setNewTask({ ...newTask, project_id: e.target.value })} className="w-full mt-1">
                    <option value="">None</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>Priority</label>
                  <select value={newTask.priority_hint}
                    onChange={(e) => setNewTask({ ...newTask, priority_hint: e.target.value })} className="w-full mt-1">
                    <option value="">None</option>
                    <option value="P0">P0 — Critical</option>
                    <option value="P1">P1 — High</option>
                    <option value="P2">P2 — Normal</option>
                    <option value="P3">P3 — Low</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>Assignee</label>
                <input placeholder="e.g. shivam, mansi" value={newTask.owner}
                  onChange={(e) => setNewTask({ ...newTask, owner: e.target.value })} className="w-full mt-1" />
              </div>
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>Tags (comma-separated)</label>
                <input placeholder="e.g. urgent, sprint, blocker" value={newTask.tags}
                  onChange={(e) => setNewTask({ ...newTask, tags: e.target.value })} className="w-full mt-1" />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowCreate(false)} className="btn btn-secondary text-[12px]">Cancel</button>
              <button onClick={createTask} disabled={!newTask.title} className="btn btn-primary text-[12px] disabled:opacity-40">Create Task</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
