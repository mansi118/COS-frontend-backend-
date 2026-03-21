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
    }>;
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
  const [loading, setLoading] = useState(true);
  const { lastMessage, isConnected } = useWebSocket();

  const load = () => {
    Promise.all([
      fetch(`${API}/api/pulse`).then((r) => r.json()),
      fetch(`${API}/api/briefing/morning`).then((r) => r.json()),
      fetch(`${API}/api/meetings/today`).then((r) => r.json()).catch(() => []),
    ]).then(([pulseData, briefingData, meetingsData]) => {
      setPulse(pulseData);
      setBriefing(briefingData);
      setMeetings(Array.isArray(meetingsData) ? meetingsData : meetingsData.meetings || []);
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
        <StatCard label="Active Tasks" value={pulse.stats.active_tasks} borderColor="blue" />
        <StatCard label="Done Today" value={pulse.stats.done_today} borderColor="green" />
        <StatCard label="Overdue" value={pulse.stats.overdue} borderColor="red" />
        <StatCard label="Team Reliability" value={`${pulse.stats.team_reliability}%`} borderColor="yellow" />
      </div>

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

      {/* Team Members */}
      <div>
        <p className="section-label">Team</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
          {pulse.team.map((member) => (
            <TeamMemberCard key={member.slug} {...member} />
          ))}
        </div>
      </div>
    </div>
  );
}
