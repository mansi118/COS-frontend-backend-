'use client';

import { useEffect, useState } from 'react';
import FollowupCard from '@/components/FollowupCard';
import useWebSocket from '@/components/useWebSocket';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const EXECUTE_URL = `${API}/api/execute`;

interface ChecklistItem {
  text: string;
  priority: string;
  completed: boolean;
}

interface Followup {
  id: number;
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
}

interface Task {
  id: number;
  title: string;
  assignee: string | null;
  status: string;
  priority: string | null;
  due: string | null;
}

export default function FollowupsPage() {
  const [followups, setFollowups] = useState<Followup[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [filterWho, setFilterWho] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [newFu, setNewFu] = useState({ what: '', who: '', due: '', priority: 'P2' });
  const [editFu, setEditFu] = useState<Followup | null>(null);
  const [editForm, setEditForm] = useState({ what: '', who: '', due: '', priority: 'P2', status: 'open' });
  const [gatewayConnected, setGatewayConnected] = useState<boolean | null>(null);
  const { lastMessage } = useWebSocket();

  const load = () => {
    fetch(`${API}/api/followups`).then((r) => r.json()).then(setFollowups);
    fetch(`${API}/api/tasks`).then((r) => r.json()).then((d) => setTasks(Array.isArray(d) ? d : d.tasks || [])).catch(() => setTasks([]));
  };

  useEffect(() => { load(); }, []);
  useEffect(() => { if (lastMessage?.type === 'followup_update') load(); }, [lastMessage]);
  useEffect(() => {
    fetch(`${API}/api/gateway/status`)
      .then((r) => r.json())
      .then((d) => setGatewayConnected(d.connected === true))
      .catch(() => setGatewayConnected(false));
  }, []);

  // --- Actions (all via OpenClaw) ---

  const create = async () => {
    if (!newFu.what || !newFu.who) return;
    setCreating(true);
    try {
      const res = await fetch(EXECUTE_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_followup',
          args: { what: newFu.what, who: newFu.who, due: newFu.due || 'not set', priority: newFu.priority },
        }),
      });
      const data = await res.json();
      if (data.success) {
        setShowCreate(false);
        setNewFu({ what: '', who: '', due: '', priority: 'P2' });
        setResult('Follow-up created via OpenClaw');
        load();
      } else {
        setResult(`Failed: ${data.error}`);
      }
    } catch { setResult('Failed to connect to gateway'); }
    finally { setCreating(false); setTimeout(() => setResult(null), 4000); }
  };

  const saveEdit = async () => {
    if (!editFu || !editForm.what || !editForm.who) return;
    setEditing(true);
    try {
      const res = await fetch(EXECUTE_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'edit_followup',
          args: {
            fu_id: editFu.fu_id,
            what: editForm.what,
            who: editForm.who,
            due: editForm.due || 'not set',
            priority: editForm.priority,
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        setEditFu(null);
        setResult('Follow-up updated via OpenClaw');
        load();
      } else {
        setResult(`Failed: ${data.error}`);
      }
    } catch { setResult('Failed to connect to gateway'); }
    finally { setEditing(false); setTimeout(() => setResult(null), 4000); }
  };

  const deleteFu = async (fuId: string) => {
    try {
      const res = await fetch(EXECUTE_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_followup', args: { fu_id: fuId } }),
      });
      const data = await res.json();
      setResult(data.success ? 'Follow-up deleted' : `Failed: ${data.error}`);
      load();
    } catch { setResult('Failed to connect to gateway'); }
    finally { setTimeout(() => setResult(null), 4000); }
  };

  const changeStatus = async (fuId: string, newStatus: string) => {
    try {
      await fetch(EXECUTE_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_followup_status', args: { fu_id: fuId, status: newStatus } }),
      });
      load();
    } catch { /* ignore */ }
  };

  // Toggle uses direct API (not OpenClaw) for instant response
  const toggleItem = async (fuId: string, itemIndex: number) => {
    try {
      await fetch(`${API}/api/followups/${fuId}/checklist/${itemIndex}/toggle`, { method: 'PUT' });
      load();
    } catch { /* ignore */ }
  };

  const openEdit = (fuId: string) => {
    const fu = followups.find((f) => f.fu_id === fuId);
    if (!fu) return;
    setEditFu(fu);
    setEditForm({
      what: fu.what || '',
      who: fu.who || '',
      due: fu.due || '',
      priority: fu.priority || 'P2',
      status: fu.status || 'open',
    });
  };

  // --- Filtering ---

  const filtered = followups.filter((f) => {
    if (filterWho && f.who !== filterWho) return false;
    if (filterPriority && f.priority !== filterPriority) return false;
    if (filterSource && f.source !== filterSource) return false;
    return true;
  });

  const open = filtered.filter((f) => f.status === 'open' || f.status === 'overdue');
  const inProgress = filtered.filter((f) => f.status === 'in_progress');
  const resolved = filtered.filter((f) => f.status === 'resolved');
  const uniqueWhos = Array.from(new Set(followups.map((f) => f.who).filter(Boolean)));

  const taskStatusColor = (status: string) => {
    if (status === 'done' || status === 'completed') return 'badge-green';
    if (status === 'in_progress') return 'badge-blue';
    if (status === 'blocked') return 'badge-red';
    return 'badge-gray';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-100">Follow-ups & Tasks</h2>
          <p className="text-[12px] text-gray-500 mt-0.5">{followups.length} total items</p>
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
          <button onClick={() => setView(view === 'kanban' ? 'list' : 'kanban')} className="btn btn-secondary text-[12px]">
            {view === 'kanban' ? 'List' : 'Kanban'}
          </button>
          <button onClick={() => setShowCreate(true)} className="btn btn-primary text-[12px]">
            + New
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <select value={filterWho} onChange={(e) => setFilterWho(e.target.value)} className="text-[12px]">
          <option value="">All People</option>
          {uniqueWhos.map((w) => <option key={w} value={w!}>{w}</option>)}
        </select>
        <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)} className="text-[12px]">
          <option value="">All Priorities</option>
          <option value="P0">P0</option>
          <option value="P1">P1</option>
          <option value="P2">P2</option>
          <option value="P3">P3</option>
        </select>
        <select value={filterSource} onChange={(e) => setFilterSource(e.target.value)} className="text-[12px]">
          <option value="">All Sources</option>
          <option value="standup">Standup</option>
          <option value="meeting">Meeting</option>
          <option value="manual">Manual</option>
        </select>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="modal-overlay">
          <div className="modal-panel p-6">
            <h3 className="text-base font-semibold mb-1" style={{ color: '#e5e7eb' }}>New Follow-up</h3>
            <p className="text-[11px] mb-4" style={{ color: '#6b7280' }}>Create a new follow-up item</p>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>What needs to be done? *</label>
                <input placeholder="Review proposal, fix bug, send docs..." value={newFu.what} onChange={(e) => setNewFu({ ...newFu, what: e.target.value })} className="w-full mt-1" />
              </div>
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>Assign to *</label>
                <input placeholder="e.g. shivam, mansi, naveen" value={newFu.who} onChange={(e) => setNewFu({ ...newFu, who: e.target.value })} className="w-full mt-1" />
              </div>
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>Due date</label>
                <input type="date" value={newFu.due} onChange={(e) => setNewFu({ ...newFu, due: e.target.value })} className="w-full mt-1" />
              </div>
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>Priority</label>
                <select value={newFu.priority} onChange={(e) => setNewFu({ ...newFu, priority: e.target.value })} className="w-full mt-1">
                  <option value="P0">P0 — Critical</option>
                  <option value="P1">P1 — High</option>
                  <option value="P2">P2 — Normal</option>
                  <option value="P3">P3 — Low</option>
                </select>
              </div>
            </div>

            {gatewayConnected === false && (
              <p className="text-[11px] mt-2" style={{ color: '#f87171' }}>
                OpenClaw gateway is offline. Creating is temporarily unavailable.
              </p>
            )}

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowCreate(false)} className="btn btn-secondary text-[12px]">Cancel</button>
              <button onClick={create} disabled={creating || !newFu.what || !newFu.who || gatewayConnected === false}
                className="btn btn-primary text-[12px] disabled:opacity-40">
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editFu && (
        <div className="modal-overlay">
          <div className="modal-panel p-6">
            <h3 className="text-base font-semibold mb-1" style={{ color: '#e5e7eb' }}>Edit Follow-up</h3>
            <p className="text-[11px] mb-4" style={{ color: '#6b7280' }}>{editFu.fu_id} — {editFu.source ? `Source: ${editFu.source}` : 'Manual'}</p>
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>What *</label>
                <input value={editForm.what} onChange={(e) => setEditForm({ ...editForm, what: e.target.value })} className="w-full mt-1" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>Assign to *</label>
                  <input value={editForm.who} onChange={(e) => setEditForm({ ...editForm, who: e.target.value })} className="w-full mt-1" />
                </div>
                <div>
                  <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>Due date</label>
                  <input type="date" value={editForm.due} onChange={(e) => setEditForm({ ...editForm, due: e.target.value })} className="w-full mt-1" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>Priority</label>
                  <select value={editForm.priority} onChange={(e) => setEditForm({ ...editForm, priority: e.target.value })} className="w-full mt-1">
                    <option value="P0">P0 — Critical</option>
                    <option value="P1">P1 — High</option>
                    <option value="P2">P2 — Normal</option>
                    <option value="P3">P3 — Low</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>Status</label>
                  <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })} className="w-full mt-1">
                    <option value="open">Open</option>
                    <option value="in_progress">In Progress</option>
                    <option value="resolved">Resolved</option>
                  </select>
                </div>
              </div>

              {/* Progress / Checklist section */}
              {editFu.checklist && editFu.checklist.length > 0 && (
                <div>
                  <label className="text-[11px] font-medium uppercase tracking-wider block mb-2" style={{ color: '#6b7280' }}>
                    Progress — {editFu.checklist.filter((c) => c.completed).length}/{editFu.checklist.length} done
                  </label>
                  <div className="rounded-lg p-3 space-y-1.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    {/* Progress bar */}
                    <div className="h-1.5 rounded-full overflow-hidden mb-2" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <div className="h-full rounded-full transition-all" style={{
                        width: `${(editFu.checklist.filter((c) => c.completed).length / editFu.checklist.length) * 100}%`,
                        background: editFu.checklist.every((c) => c.completed) ? '#4ade80' : '#818cf8',
                      }} />
                    </div>
                    {editFu.checklist.map((item, i) => (
                      <div key={i} className="flex items-center gap-2 py-1">
                        <button
                          onClick={() => toggleItem(editFu.fu_id, i).then(() => {
                            // Refresh editFu data
                            fetch(`${API}/api/followups`).then((r) => r.json()).then((fus) => {
                              const updated = fus.find((f: Followup) => f.fu_id === editFu.fu_id);
                              if (updated) { setEditFu(updated); setFollowups(fus); }
                            });
                          })}
                          className="w-5 h-5 rounded flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                          style={{
                            background: item.completed ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.04)',
                            border: `1px solid ${item.completed ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.1)'}`,
                            color: item.completed ? '#4ade80' : '#4b5563',
                          }}
                        >
                          <span className="text-[10px]">{item.completed ? '✓' : ''}</span>
                        </button>
                        <span className={`text-[12px] flex-1 ${item.completed ? 'line-through' : ''}`}
                          style={{ color: item.completed ? '#4b5563' : '#d1d5db' }}>
                          {item.text}
                        </span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0 priority-${item.priority}`}>
                          {item.priority}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setEditFu(null)} className="btn btn-secondary text-[12px]">Cancel</button>
              <button onClick={saveEdit} disabled={editing || !editForm.what || !editForm.who}
                className="btn btn-primary text-[12px] disabled:opacity-40">
                {editing ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Kanban View */}
      {view === 'kanban' ? (
        <div className="grid grid-cols-3 gap-5">
          {[
            { title: 'Open', items: open, dot: 'bg-gray-400' },
            { title: 'In Progress', items: inProgress, dot: 'bg-indigo-500' },
            { title: 'Resolved', items: resolved, dot: 'bg-emerald-500' },
          ].map((col) => (
            <div key={col.title}>
              <div className="flex items-center gap-2 mb-3">
                <span className={`w-2 h-2 rounded-full ${col.dot}`} />
                <h3 className="text-[12px] font-semibold text-gray-500 uppercase tracking-wider">{col.title}</h3>
                <span className="text-[11px] text-gray-600 font-medium">{col.items.length}</span>
              </div>
              <div className="space-y-2">
                {col.items.map((f) => (
                  <FollowupCard key={f.id} {...f}
                    onToggleItem={toggleItem}
                    onEdit={openEdit}
                    onDelete={deleteFu}
                    onStatusChange={changeStatus}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((f) => (
            <FollowupCard key={f.id} {...f}
              onToggleItem={toggleItem}
              onEdit={openEdit}
              onDelete={deleteFu}
              onStatusChange={changeStatus}
            />
          ))}
        </div>
      )}

      {/* Tasks Section */}
      {tasks.length > 0 && (
        <div>
          <p className="section-label">Tasks</p>
          <div className="card overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="text-left px-5 py-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Task</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Assignee</th>
                  <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Priority</th>
                  <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Due</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3 font-medium text-gray-100">{t.title}</td>
                    <td className="px-4 py-3 text-gray-500">{t.assignee || '—'}</td>
                    <td className="px-4 py-3 text-center">
                      {t.priority ? <span className={`badge priority-${t.priority}`}>{t.priority}</span> : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`badge ${taskStatusColor(t.status)}`}>{t.status}</span>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-500">{t.due || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
