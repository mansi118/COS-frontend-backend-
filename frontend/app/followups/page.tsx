'use client';

import { useEffect, useState } from 'react';
import FollowupCard from '@/components/FollowupCard';
import useWebSocket from '@/components/useWebSocket';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface Followup {
  id: number;
  fu_id: string;
  what: string;
  who: string | null;
  due: string | null;
  priority: string | null;
  status: string;
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
  const [showCreate, setShowCreate] = useState(false);
  const [newFu, setNewFu] = useState({ what: '', who: '', due: '', priority: 'P2', source: '' });
  const { lastMessage } = useWebSocket();

  const load = () => {
    fetch(`${API}/api/followups`).then((r) => r.json()).then(setFollowups);
    fetch(`${API}/api/tasks`).then((r) => r.json()).then((d) => setTasks(Array.isArray(d) ? d : d.tasks || [])).catch(() => setTasks([]));
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (lastMessage?.type === 'followup_update') {
      load();
    }
  }, [lastMessage]);

  const resolve = async (id: number) => {
    await fetch(`${API}/api/followups/${id}/resolve`, { method: 'PUT' });
    load();
  };

  const create = async () => {
    await fetch(`${API}/api/followups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        what: newFu.what,
        who: newFu.who,
        due: newFu.due || null,
        priority: newFu.priority,
        source: newFu.source || null,
      }),
    });
    setShowCreate(false);
    setNewFu({ what: '', who: '', due: '', priority: 'P2', source: '' });
    load();
  };

  const filtered = followups.filter((f) => {
    if (filterWho && f.who !== filterWho) return false;
    if (filterPriority && f.priority !== filterPriority) return false;
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
        <div className="flex gap-2">
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
          <option value="P1">P1</option>
          <option value="P2">P2</option>
          <option value="P3">P3</option>
        </select>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="modal-overlay">
          <div className="modal-panel p-6">
            <h3 className="text-base font-semibold mb-4">New Follow-up</h3>
            <div className="space-y-3">
              <input placeholder="What needs to be done?" value={newFu.what} onChange={(e) => setNewFu({ ...newFu, what: e.target.value })} className="w-full" />
              <input placeholder="Assign to (slug)" value={newFu.who} onChange={(e) => setNewFu({ ...newFu, who: e.target.value })} className="w-full" />
              <input type="date" value={newFu.due} onChange={(e) => setNewFu({ ...newFu, due: e.target.value })} className="w-full" />
              <select value={newFu.priority} onChange={(e) => setNewFu({ ...newFu, priority: e.target.value })} className="w-full">
                <option value="P1">P1 — Critical</option>
                <option value="P2">P2 — Normal</option>
                <option value="P3">P3 — Low</option>
              </select>
              <input placeholder="Source (optional)" value={newFu.source} onChange={(e) => setNewFu({ ...newFu, source: e.target.value })} className="w-full" />
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowCreate(false)} className="btn btn-secondary text-[12px]">Cancel</button>
              <button onClick={create} disabled={!newFu.what || !newFu.who} className="btn btn-primary text-[12px] disabled:opacity-40">Create</button>
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
                {col.items.map((f) => <FollowupCard key={f.id} {...f} onResolve={col.title !== 'Resolved' ? resolve : undefined} />)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((f) => <FollowupCard key={f.id} {...f} onResolve={resolve} />)}
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
    </div>
  );
}
