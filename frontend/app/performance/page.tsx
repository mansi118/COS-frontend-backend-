'use client';

import { useEffect, useState } from 'react';
import PerformanceChart from '@/components/PerformanceChart';
import useWebSocket from '@/components/useWebSocket';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface TeamPerf {
  name: string;
  slug: string;
  emoji: string;
  score: number;
  rating: string;
  total_assigned: number;
  total_completed: number;
  completion_rate: number;
  on_time_rate: number;
  overdue_count: number;
}

interface HistoryPoint {
  date: string;
  score: number;
  completion_rate: number;
  on_time_rate: number;
}

export default function PerformancePage() {
  const [team, setTeam] = useState<TeamPerf[]>([]);
  const [flagged, setFlagged] = useState<Array<{ name: string; slug: string; score: number; rating: string }>>([]);
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const { lastMessage } = useWebSocket();

  const load = () => {
    fetch(`${API}/api/performance/report?period=biweekly`).then((r) => r.json()).then((d) => setTeam(d.team));
    fetch(`${API}/api/performance/flag`).then((r) => r.json()).then((d) => setFlagged(d.flagged));
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (lastMessage?.type === 'performance_update') {
      load();
    }
  }, [lastMessage]);

  useEffect(() => {
    if (selectedPerson) {
      fetch(`${API}/api/performance/${selectedPerson}/history`).then((r) => r.json()).then((d) => setHistory(d.history));
    }
  }, [selectedPerson]);

  const ratingBadge = (rating: string) => {
    if (rating.includes('Excellent')) return 'badge-green';
    if (rating.includes('Good')) return 'badge-blue';
    return 'badge-red';
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-gray-100">Performance & Analytics</h2>
        <p className="text-[12px] text-gray-500 mt-0.5">Biweekly team evaluation</p>
      </div>

      {/* Alerts */}
      {flagged.length > 0 && (
        <div className="card p-4 border-red-100 bg-red-500/[0.08]">
          <p className="text-[11px] font-semibold text-red-400 uppercase tracking-wider mb-1">Low Performer Alerts</p>
          <div className="flex gap-4">
            {flagged.map((f) => (
              <span key={f.slug} className="text-[12px] text-red-400 font-medium">
                {f.name}: {f.score} pts
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Scorecard Table */}
      <div className="card overflow-hidden">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-white/[0.06]">
              <th className="text-left px-5 py-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Name</th>
              <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Score</th>
              <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Rating</th>
              <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Done</th>
              <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">On-time</th>
              <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Overdue</th>
              <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Trend</th>
            </tr>
          </thead>
          <tbody>
            {team.map((p) => (
              <tr key={p.slug} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors">
                <td className="px-5 py-3.5 font-medium text-gray-100">
                  <span className="mr-2">{p.emoji}</span>{p.name}
                </td>
                <td className="px-4 py-3.5 text-center font-bold tabular-nums">{p.score}</td>
                <td className="px-4 py-3.5 text-center">
                  <span className={`badge ${ratingBadge(p.rating)}`}>{p.rating}</span>
                </td>
                <td className="px-4 py-3.5 text-center text-gray-500 tabular-nums">{p.total_completed}/{p.total_assigned}</td>
                <td className="px-4 py-3.5 text-center tabular-nums">{p.on_time_rate}%</td>
                <td className="px-4 py-3.5 text-center">
                  {p.overdue_count > 2
                    ? <span className="badge badge-red">{p.overdue_count}</span>
                    : <span className="text-gray-500">{p.overdue_count}</span>
                  }
                </td>
                <td className="px-4 py-3.5 text-center">
                  <button
                    onClick={() => setSelectedPerson(p.slug === selectedPerson ? null : p.slug)}
                    className={`text-[11px] font-medium px-2 py-1 rounded-md transition-colors ${
                      p.slug === selectedPerson ? 'bg-indigo-100 text-indigo-400' : 'text-indigo-500 hover:bg-indigo-50'
                    }`}
                  >
                    {p.slug === selectedPerson ? 'Hide' : 'View'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Person Trend Chart */}
      {selectedPerson && history.length > 0 && (
        <PerformanceChart
          data={history}
          title={`Trend — ${team.find((t) => t.slug === selectedPerson)?.name || selectedPerson}`}
        />
      )}
    </div>
  );
}
