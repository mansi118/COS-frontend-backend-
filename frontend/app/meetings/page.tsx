'use client';

import { useEffect, useState } from 'react';
import useWebSocket from '@/components/useWebSocket';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface Meeting {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  meet_link: string | null;
  attendees: string[];
  description: string | null;
}

export default function MeetingsPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const { lastMessage } = useWebSocket();

  const load = () => {
    fetch(`${API}/api/meetings/today`)
      .then((r) => r.json())
      .then((d) => {
        setMeetings(Array.isArray(d) ? d : d.meetings || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (lastMessage?.type === 'meeting_update') {
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

  const formatTimeRange = (start: string, end: string) => {
    return `${formatTime(start)} - ${formatTime(end)}`;
  };

  const isNow = (start: string, end: string) => {
    const now = new Date();
    return new Date(start) <= now && now <= new Date(end);
  };

  const isPast = (end: string) => {
    return new Date(end) < new Date();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-sm text-gray-500">Loading meetings...</div>
      </div>
    );
  }

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-gray-100">Meetings</h2>
        <p className="text-[12px] text-gray-500 mt-0.5">{today}</p>
      </div>

      {meetings.length === 0 ? (
        <div className="card p-12 text-center">
          <p className="text-sm text-gray-500">No meetings scheduled for today.</p>
          <p className="text-[11px] text-gray-600 mt-1">Enjoy the focus time.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {meetings.map((m, i) => {
            const live = isNow(m.start_time, m.end_time);
            const past = isPast(m.end_time);

            return (
              <div
                key={m.id || i}
                className={`card p-0 overflow-hidden ${live ? 'border-indigo-200' : ''} ${past ? 'opacity-60' : ''}`}
              >
                <div className="flex">
                  {/* Time column */}
                  <div className={`w-28 shrink-0 flex flex-col items-center justify-center py-5 border-r border-white/[0.04] ${live ? 'bg-indigo-50/50' : 'bg-white/[0.03]/30'}`}>
                    <span className={`text-[13px] font-semibold ${live ? 'text-indigo-400' : 'text-gray-600'}`}>
                      {formatTime(m.start_time)}
                    </span>
                    <span className="text-[10px] text-gray-500 mt-0.5">{formatTime(m.end_time)}</span>
                    {live && (
                      <span className="badge badge-blue mt-2 text-[9px]">NOW</span>
                    )}
                    {past && (
                      <span className="badge badge-gray mt-2 text-[9px]">DONE</span>
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 p-5">
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="text-[14px] font-semibold text-gray-100 leading-snug">{m.title}</h3>
                      {m.meet_link && (
                        <a
                          href={m.meet_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`btn text-[11px] py-1 px-3 shrink-0 ml-3 ${live ? 'btn-primary' : 'btn-secondary'}`}
                        >
                          Join Meeting
                        </a>
                      )}
                    </div>

                    {m.description && (
                      <p className="text-[12px] text-gray-500 leading-relaxed mb-3">{m.description}</p>
                    )}

                    {m.attendees && m.attendees.length > 0 && (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">Attendees:</span>
                        {m.attendees.map((a, j) => (
                          <span key={j} className="text-[11px] px-2 py-0.5 rounded-full bg-white/[0.04] text-gray-500 font-medium">{a}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Summary */}
      {meetings.length > 0 && (
        <div className="flex gap-6 text-[12px] text-gray-500">
          <span>{meetings.length} meeting{meetings.length > 1 ? 's' : ''} today</span>
          <span>{formatTimeRange(meetings[0].start_time, meetings[meetings.length - 1].end_time)}</span>
        </div>
      )}
    </div>
  );
}
