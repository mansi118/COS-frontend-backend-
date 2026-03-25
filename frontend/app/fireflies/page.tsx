'use client';

import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
const EXECUTE_URL = `${API}/api/execute`;

// --- Interfaces ---

interface Transcript {
  id: string;
  title: string;
  date: string;
  duration_mins: number;
  host: string | null;
  attendees: Array<{ name: string | null; email: string }>;
}

interface TranscriptDetail extends Transcript {
  url: string | null;
  action_items: string[];
  outline: string[];
  keywords: string[];
  bullet_summary: string[];
  sentences: Array<{ speaker: string; text: string; start: number | null; end: number | null }>;
}

interface ActionMeeting {
  id: string;
  title: string;
  date: string;
  action_items: string[];
}

interface MeetingIntelligence {
  decisions: string[];
  risks: string[];
  sentiment: string;
  sentiment_score: number;
  notable_quotes: Array<{ speaker: string; quote: string }>;
  executive_summary: string;
}

interface Contact {
  slug: string;
  email: string | null;
}

interface DateRange {
  from: string;
  to: string;
}

// --- Helpers ---

function toLines(val: string | string[] | null | undefined): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return val.split('\n').map((l) => l.trim()).filter(Boolean);
}

const AVATAR_COLORS = ['#818cf8', '#f472b6', '#34d399', '#fbbf24', '#fb923c', '#a78bfa', '#22d3ee'];

function getInitials(name: string | null, email: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    return parts.length > 1
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : parts[0].slice(0, 2).toUpperCase();
  }
  return email.slice(0, 2).toUpperCase();
}

function formatDateHeader(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function groupByDate(transcripts: Transcript[]): Array<{ date: string; label: string; items: Transcript[] }> {
  const map: Record<string, Transcript[]> = {};
  for (const t of transcripts) {
    const key = (t.date || 'Unknown').split('T')[0];
    if (!map[key]) map[key] = [];
    map[key].push(t);
  }
  return Object.entries(map)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, items]) => ({ date, label: formatDateHeader(date), items }));
}

function formatTimestamp(val: number | null): string {
  if (val === null || val === undefined) return '';
  const seconds = val > 10000 ? val / 1000 : val;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// --- Page Component ---

export default function FirefliesPage() {
  // Data
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [actions, setActions] = useState<ActionMeeting[]>([]);
  const [selected, setSelected] = useState<TranscriptDetail | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [intelligence, setIntelligence] = useState<MeetingIntelligence | null>(null);
  const [intelligenceCache, setIntelligenceCache] = useState<Record<string, MeetingIntelligence>>({});

  // Loading states (progressive — each section loads independently)
  const [gatewayConnected, setGatewayConnected] = useState<boolean | null>(null);
  const [transcriptsLoading, setTranscriptsLoading] = useState(true);
  const [actionsLoading, setActionsLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [intelligenceLoading, setIntelligenceLoading] = useState(false);
  const [intelligenceError, setIntelligenceError] = useState<string | null>(null);
  const [intelligenceElapsed, setIntelligenceElapsed] = useState(0);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [transcriptsError, setTranscriptsError] = useState<string | null>(null);
  const [actionsError, setActionsError] = useState<string | null>(null);

  // UI
  const [tab, setTab] = useState<'timeline' | 'transcripts' | 'actions' | 'search'>('transcripts');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Transcript[] | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [transcriptLimit, setTranscriptLimit] = useState(50);
  const [dateRange, setDateRange] = useState<DateRange>({ from: '', to: '' });
  const [extractedIds, setExtractedIds] = useState<Set<string>>(new Set());
  const [extractResult, setExtractResult] = useState<string | null>(null);
  const [showJoin, setShowJoin] = useState(false);
  const [joinLink, setJoinLink] = useState('');
  const [joining, setJoining] = useState(false);

  // --- Data Fetching ---

  const loadTranscripts = (from?: string, to?: string) => {
    setTranscriptsLoading(true);
    setTranscriptsError(null);
    let url = `${API}/api/fireflies/list?limit=15`;
    if (from) url += `&from=${from}`;
    if (to) url += `&to=${to}`;
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setTranscriptsError(typeof d.error === 'string' ? d.error : JSON.stringify(d.error).slice(0, 200));
          setTranscripts([]);
        } else {
          setTranscripts(d.transcripts || []);
        }
      })
      .catch(() => setTranscriptsError('Failed to fetch transcripts'))
      .finally(() => setTranscriptsLoading(false));
  };

  const loadActions = (from?: string, to?: string) => {
    setActionsLoading(true);
    setActionsError(null);
    let url = `${API}/api/fireflies/actions?limit=10`;
    if (from) url += `&from=${from}`;
    if (to) url += `&to=${to}`;
    fetch(url)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setActionsError(typeof d.error === 'string' ? d.error : JSON.stringify(d.error).slice(0, 200));
          setActions([]);
        } else {
          setActions(d.meetings || []);
        }
      })
      .catch(() => setActionsError('Failed to fetch action items'))
      .finally(() => setActionsLoading(false));
  };

  // Elapsed timer for intelligence loading
  useEffect(() => {
    if (!intelligenceLoading) { setIntelligenceElapsed(0); return; }
    const timer = setInterval(() => setIntelligenceElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, [intelligenceLoading]);

  // Initial load: config first (fast), then data fetches independently
  useEffect(() => {
    fetch(`${API}/api/fireflies/config`)
      .then((r) => r.json())
      .then((d) => {
        const connected = d.configured === true;
        setGatewayConnected(connected);
        if (connected) {
          loadTranscripts();
          loadActions();
          fetch(`${API}/api/email/contacts`)
            .then((r) => r.json())
            .then((d) => setContacts((d.contacts || []).filter((c: Contact) => c.email)))
            .catch(() => {});
          // Auto-extract MOM from recent meetings
          fetch(`${API}/api/fireflies/auto-extract?days=30&limit=15`, { method: 'POST' })
            .then((r) => r.json())
            .then((d) => {
              if (d.extracted_transcript_ids) setExtractedIds(new Set(d.extracted_transcript_ids));
              if (d.processed > 0) {
                setExtractResult(`Auto-extracted ${d.processed} meeting(s) into follow-ups`);
                setTimeout(() => setExtractResult(null), 5000);
              }
            })
            .catch(() => {});
        } else {
          setTranscriptsLoading(false);
          setActionsLoading(false);
        }
      })
      .catch(() => {
        setGatewayConnected(false);
        setTranscriptsLoading(false);
        setActionsLoading(false);
      });
  }, []);

  // Re-fetch when date range changes
  const applyDateFilter = () => {
    loadTranscripts(dateRange.from || undefined, dateRange.to || undefined);
    loadActions(dateRange.from || undefined, dateRange.to || undefined);
  };

  // --- Join Meeting ---

  const joinMeeting = async () => {
    if (!joinLink) return;
    setJoining(true);
    try {
      const res = await fetch(`${API}/api/fireflies/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meeting_link: joinLink }),
      });
      const data = await res.json();
      if (data.status === 'joining') {
        setSendResult(`Bot joining ${data.platform} meeting: ${data.meeting_id}`);
        setJoinLink('');
        setShowJoin(false);
        loadTranscripts();
      } else {
        setSendResult(`Failed: ${data.error || 'Unknown error'}`);
      }
    } catch { setSendResult('Failed to connect'); }
    finally { setJoining(false); setTimeout(() => setSendResult(null), 5000); }
  };

  // --- Actions ---

  const openTranscript = async (id: string) => {
    setDetailLoading(true);
    setIntelligence(null);
    setIntelligenceError(null);
    setShowTranscript(false);
    setTranscriptLimit(50);
    try {
      const res = await fetch(`${API}/api/fireflies/transcript/${id}`);
      const data = await res.json();
      if (!data.error) {
        setSelected(data);
        // Load cached intelligence if available
        if (intelligenceCache[id]) {
          setIntelligence(intelligenceCache[id]);
        }
      }
    } finally {
      setDetailLoading(false);
    }
  };

  const generateIntelligence = async (transcriptId: string, forceRefresh = false) => {
    // Check cache first (unless forced)
    if (!forceRefresh && intelligenceCache[transcriptId]) {
      setIntelligence(intelligenceCache[transcriptId]);
      setIntelligenceError(null);
      return;
    }
    setIntelligenceLoading(true);
    setIntelligenceError(null);
    try {
      const res = await fetch(`${API}/api/fireflies/intelligence/${transcriptId}`);
      const data = await res.json();
      if (data.error) {
        setIntelligenceError(typeof data.error === 'string' ? data.error : JSON.stringify(data.error).slice(0, 200));
        setIntelligence(null);
      } else {
        // Check if result has any meaningful content
        const hasContent = data.executive_summary ||
          (data.decisions && data.decisions.length > 0) ||
          (data.risks && data.risks.length > 0);
        if (hasContent) {
          setIntelligence(data);
          setIntelligenceCache((prev) => ({ ...prev, [transcriptId]: data }));
          setIntelligenceError(null);
        } else {
          setIntelligenceError('No insights could be extracted from this transcript');
          setIntelligence(null);
        }
      }
    } catch {
      setIntelligenceError('Failed to connect to backend');
      setIntelligence(null);
    } finally {
      setIntelligenceLoading(false);
    }
  };

  const search = async () => {
    if (!searchQuery.trim()) { setSearchResults(null); return; }
    try {
      const res = await fetch(`${API}/api/fireflies/search?keyword=${encodeURIComponent(searchQuery)}&limit=10`);
      const data = await res.json();
      if (data.error) {
        setSendResult(`Search failed: ${typeof data.error === 'string' ? data.error : 'API error'}`);
        setSearchResults([]);
      } else {
        setSearchResults(data.results || []);
      }
    } catch {
      setSendResult('Search failed: could not connect');
      setSearchResults([]);
    }
  };

  const sendToTeam = async (transcriptId: string) => {
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch(EXECUTE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send_meeting_notes',
          args: { transcript_id: transcriptId, recipients: 'all team members' },
        }),
      });
      const data = await res.json();
      setSendResult(data.success ? (data.result || 'Sent via OpenClaw') : `Failed: ${typeof data.error === 'string' ? data.error : 'API error'}`);
    } catch {
      setSendResult('Failed to connect');
    } finally {
      setSending(false);
      setTimeout(() => setSendResult(null), 5000);
    }
  };

  const sendToRecipients = async (transcriptId: string, recipients: string[]) => {
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch(EXECUTE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send_meeting_notes',
          args: { transcript_id: transcriptId, recipients: recipients.join(', ') },
        }),
      });
      const data = await res.json();
      setSendResult(data.success ? (data.result || 'Sent via OpenClaw') : `Failed: ${typeof data.error === 'string' ? data.error : 'API error'}`);
    } catch {
      setSendResult('Failed to connect');
    } finally {
      setSending(false);
      setTimeout(() => setSendResult(null), 5000);
    }
  };

  // --- Export ---

  const exportMarkdown = () => {
    if (!selected) return;
    const lines = [
      `# Meeting: ${selected.title}`,
      '',
      `**Date:** ${selected.date}`,
      `**Duration:** ${selected.duration_mins} minutes`,
      `**Host:** ${selected.host || 'N/A'}`,
    ];
    if (selected.attendees.length > 0) {
      lines.push(`**Attendees:** ${selected.attendees.map((a) => a.name || a.email).join(', ')}`);
    }
    if (selected.url) lines.push(`**Transcript URL:** ${selected.url}`);
    lines.push('');
    if (selected.bullet_summary.length > 0) {
      lines.push('## Summary', '', ...selected.bullet_summary.map((s) => `- ${s}`), '');
    }
    if (selected.action_items.length > 0) {
      lines.push('## Action Items', '', ...selected.action_items.map((a) => `- [ ] ${a}`), '');
    }
    if (selected.outline.length > 0) {
      lines.push('## Outline', '', ...selected.outline.map((o) => `- ${o}`), '');
    }
    if (selected.keywords.length > 0) {
      lines.push(`## Keywords`, '', selected.keywords.join(', '), '');
    }
    if (selected.sentences.length > 0) {
      lines.push('## Transcript', '');
      for (const s of selected.sentences) {
        const ts = formatTimestamp(s.start);
        lines.push(`**${s.speaker || 'Unknown'}${ts ? ` (${ts})` : ''}:** ${s.text}`);
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selected.title.replace(/[^a-zA-Z0-9]+/g, '-')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportJSON = () => {
    if (!selected) return;
    const blob = new Blob([JSON.stringify(selected, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selected.title.replace(/[^a-zA-Z0-9]+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // --- Computed ---

  const loading = transcriptsLoading && actionsLoading;

  const totalMeetings = transcripts.length;
  const totalActions = actions.reduce((sum, m) => sum + m.action_items.length, 0);
  const avgDuration = transcripts.length > 0
    ? Math.round(transcripts.reduce((sum, t) => sum + t.duration_mins, 0) / transcripts.length)
    : 0;
  const thisWeek = (() => {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    return transcripts.filter((t) => {
      try { return new Date(t.date) >= weekAgo; } catch { return false; }
    }).length;
  })();

  const clearDateFilter = () => {
    setDateRange({ from: '', to: '' });
    loadTranscripts();
    loadActions();
  };

  // --- Render ---

  if (gatewayConnected === false) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold" style={{ color: '#e5e7eb' }}>Meetings</h2>
        <div className="card p-8 text-center">
          <p className="text-sm" style={{ color: '#f87171' }}>OpenClaw Gateway disconnected</p>
          <p className="text-[12px] mt-2" style={{ color: '#6b7280' }}>Meeting data requires the gateway. Check that OpenClaw is running.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with date picker */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold" style={{ color: '#e5e7eb' }}>Meetings</h2>
          <p className="text-[12px] mt-0.5" style={{ color: '#6b7280' }}>Meeting transcripts, action items & notes — powered by Vexa</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button onClick={() => setShowJoin(!showJoin)}
            className="btn btn-primary text-[12px]">
            {showJoin ? 'Close' : '📋 Join Meeting'}
          </button>
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-medium uppercase tracking-wider" style={{ color: '#4b5563' }}>From</label>
            <input
              type="date"
              value={dateRange.from}
              onChange={(e) => setDateRange((prev) => ({ ...prev, from: e.target.value }))}
              className="text-[11px] py-1 px-2"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: '#d1d5db' }}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-medium uppercase tracking-wider" style={{ color: '#4b5563' }}>To</label>
            <input
              type="date"
              value={dateRange.to}
              onChange={(e) => setDateRange((prev) => ({ ...prev, to: e.target.value }))}
              className="text-[11px] py-1 px-2"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px', color: '#d1d5db' }}
            />
          </div>
          <button onClick={applyDateFilter} className="btn btn-primary text-[10px] py-1.5 px-3">Filter</button>
          {(dateRange.from || dateRange.to) && (
            <button onClick={clearDateFilter} className="btn btn-ghost text-[10px] py-1.5 px-2" style={{ color: '#6b7280' }}>Clear</button>
          )}
          <div className="h-4 border-l border-white/10" />
          {gatewayConnected && (
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400" style={{ boxShadow: '0 0 6px rgba(52, 211, 153, 0.5)' }} />
              <span className="text-[10px] font-medium text-emerald-400/80">via OpenClaw</span>
            </div>
          )}
        </div>
      </div>

      {/* Join Meeting Panel */}
      {showJoin && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold mb-3" style={{ color: '#e5e7eb' }}>Join Meeting with Notetaker Bot</h3>
          <div className="flex gap-3">
            <input
              placeholder="Paste meeting link (Google Meet, Zoom, or Teams URL)"
              value={joinLink}
              onChange={(e) => setJoinLink(e.target.value)}
              className="flex-1"
            />
            <button
              onClick={joinMeeting}
              disabled={joining || !joinLink}
              className="btn btn-primary text-[12px] px-4 disabled:opacity-40 shrink-0"
            >
              {joining ? 'Joining...' : 'Send Bot'}
            </button>
          </div>
          <p className="text-[10px] mt-2" style={{ color: '#6b7280' }}>
            Supports: Google Meet (meet.google.com/...) · Zoom (zoom.us/j/...) · Teams (teams.microsoft.com/...)
          </p>
        </div>
      )}

      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Meetings', value: transcriptsLoading ? '—' : totalMeetings, color: '#818cf8' },
          { label: 'Action Items', value: actionsLoading ? '—' : totalActions, color: '#f87171' },
          { label: 'Avg Duration', value: transcriptsLoading ? '—' : `${avgDuration}m`, color: '#fbbf24' },
          { label: 'This Week', value: transcriptsLoading ? '—' : thisWeek, color: '#4ade80' },
        ].map((stat) => (
          <div key={stat.label} className="card p-4" style={{ borderLeft: `3px solid ${stat.color}` }}>
            <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>{stat.label}</p>
            <p className="text-lg font-bold tabular-nums mt-1" style={{ color: '#e5e7eb' }}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)' }}>
        {([
          { key: 'timeline' as const, label: 'Timeline' },
          { key: 'transcripts' as const, label: `Transcripts (${transcripts.length})` },
          { key: 'actions' as const, label: `Action Items (${actions.length})` },
          { key: 'search' as const, label: 'Search' },
        ]).map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="px-4 py-1.5 rounded-md text-[12px] font-medium transition-all"
            style={tab === t.key
              ? { background: 'rgba(99,102,241,0.15)', color: '#818cf8' }
              : { color: '#6b7280' }
            }>
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left: List */}
        <div className="xl:col-span-2 space-y-2">

          {/* Timeline tab */}
          {tab === 'timeline' && (
            transcriptsLoading ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                  <span className="text-[12px]" style={{ color: '#818cf8' }}>Loading timeline via OpenClaw...</span>
                </div>
                {[1, 2].map((n) => (
                  <div key={n} className="animate-pulse">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-2 h-2 rounded-full bg-white/[0.06]" />
                      <div className="h-3.5 bg-white/[0.06] rounded w-48" />
                    </div>
                    <div className="ml-4 pl-4 space-y-2" style={{ borderLeft: '2px solid rgba(255,255,255,0.04)' }}>
                      {[1, 2].map((m) => (
                        <div key={m} className="card p-4">
                          <div className="h-3.5 bg-white/[0.06] rounded w-3/4 mb-2" />
                          <div className="flex gap-3"><div className="h-2.5 bg-white/[0.04] rounded w-16" /><div className="h-2.5 bg-white/[0.04] rounded w-24" /></div>
                          <div className="w-full bg-white/[0.04] rounded-full h-1 mt-2" />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : transcriptsError ? (
              <div className="card p-5" style={{ background: 'rgba(251,191,36,0.04)', border: '1px solid rgba(251,191,36,0.12)' }}>
                <p className="text-[12px] font-medium" style={{ color: '#fbbf24' }}>Could not load timeline</p>
                <p className="text-[11px] mt-1" style={{ color: '#6b7280' }}>{transcriptsError}</p>
                <button onClick={() => loadTranscripts()} className="btn btn-secondary text-[10px] py-1 mt-2">Retry</button>
              </div>
            ) : transcripts.length === 0 ? (
              <div className="card p-8 text-center">
                <p className="text-sm" style={{ color: '#6b7280' }}>No meetings to show in timeline</p>
                <p className="text-[11px] mt-1" style={{ color: '#4b5563' }}>Try adjusting the date range or check Vexa API status</p>
              </div>
            ) : (
              <div className="space-y-6">
                {groupByDate(transcripts).map((group) => (
                  <div key={group.date}>
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-2 h-2 rounded-full bg-indigo-500" />
                      <h3 className="text-[13px] font-semibold" style={{ color: '#d1d5db' }}>{group.label}</h3>
                      <span className="text-[11px]" style={{ color: '#4b5563' }}>{group.items.length} meeting{group.items.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="space-y-2 ml-4 pl-4" style={{ borderLeft: '2px solid rgba(99,102,241,0.15)' }}>
                      {group.items.map((t) => (
                        <button key={t.id} onClick={() => openTranscript(t.id)}
                          className={`w-full text-left card p-4 transition-all ${selected?.id === t.id ? 'border-indigo-500/40' : ''}`}>
                          <div className="flex items-start justify-between">
                            <div className="flex-1 min-w-0">
                              <h4 className="text-[13px] font-medium" style={{ color: '#e5e7eb' }}>
                                {t.title}
                                {extractedIds.has(t.id) && (
                                  <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded font-medium" style={{ background: 'rgba(34,197,94,0.1)', color: '#4ade80' }}>Extracted</span>
                                )}
                              </h4>
                              <div className="flex items-center gap-3 mt-1.5">
                                <span className="text-[11px] font-mono" style={{ color: '#818cf8' }}>{t.duration_mins}m</span>
                                <span className="text-[11px]" style={{ color: '#4b5563' }}>{t.host}</span>
                              </div>
                              <div className="w-full bg-white/[0.04] rounded-full h-1 mt-2">
                                <div className="bg-indigo-500/60 h-1 rounded-full transition-all" style={{ width: `${Math.min((t.duration_mins / 60) * 100, 100)}%` }} />
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0 ml-3">
                              <div className="flex -space-x-1.5">
                                {t.attendees.slice(0, 4).map((a, i) => (
                                  <div key={i} className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white border border-[#1a1a2e]"
                                    style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}
                                    title={a.name || a.email}>
                                    {getInitials(a.name, a.email)}
                                  </div>
                                ))}
                                {t.attendees.length > 4 && (
                                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-medium border border-[#1a1a2e]"
                                    style={{ background: 'rgba(255,255,255,0.08)', color: '#9ca3af' }}>
                                    +{t.attendees.length - 4}
                                  </div>
                                )}
                              </div>
                              <button onClick={(e) => { e.stopPropagation(); sendToTeam(t.id); }}
                                disabled={sending}
                                className="btn btn-primary text-[10px] py-1 px-2.5 disabled:opacity-40">
                                Send
                              </button>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {/* Transcripts tab */}
          {tab === 'transcripts' && (
            transcriptsLoading ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                  <span className="text-[12px]" style={{ color: '#818cf8' }}>Loading transcripts via OpenClaw...</span>
                </div>
                {[1, 2, 3].map((n) => (
                  <div key={n} className="card p-4 animate-pulse">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="h-3.5 bg-white/[0.06] rounded w-3/4 mb-2" />
                        <div className="flex gap-3"><div className="h-2.5 bg-white/[0.04] rounded w-20" /><div className="h-2.5 bg-white/[0.04] rounded w-12" /></div>
                        <div className="w-full bg-white/[0.04] rounded-full h-1 mt-2" />
                      </div>
                      <div className="flex items-center gap-1.5 ml-3">
                        <div className="w-6 h-6 rounded-full bg-white/[0.06]" />
                        <div className="w-6 h-6 rounded-full bg-white/[0.06]" />
                        <div className="h-7 bg-white/[0.06] rounded w-20" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : transcriptsError ? (
              <div className="card p-5" style={{ background: 'rgba(251,191,36,0.04)', border: '1px solid rgba(251,191,36,0.12)' }}>
                <p className="text-[12px] font-medium" style={{ color: '#fbbf24' }}>Could not load transcripts</p>
                <p className="text-[11px] mt-1" style={{ color: '#6b7280' }}>{transcriptsError}</p>
                <button onClick={() => loadTranscripts()} className="btn btn-secondary text-[10px] py-1 mt-2">Retry</button>
              </div>
            ) : transcripts.length === 0 ? (
              <div className="card p-8 text-center">
                <p className="text-sm" style={{ color: '#6b7280' }}>No transcripts found</p>
                <p className="text-[11px] mt-1" style={{ color: '#4b5563' }}>Try adjusting the date range or check Vexa API status</p>
              </div>
            ) : (
              transcripts.map((t) => (
                <button key={t.id} onClick={() => openTranscript(t.id)}
                  className={`w-full text-left card p-4 transition-all ${selected?.id === t.id ? 'border-indigo-500/40' : ''}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h4 className="text-[13px] font-medium" style={{ color: '#e5e7eb' }}>
                        {t.title}
                        {extractedIds.has(t.id) && (
                          <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded font-medium" style={{ background: 'rgba(34,197,94,0.1)', color: '#4ade80' }}>Extracted</span>
                        )}
                      </h4>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-[11px]" style={{ color: '#6b7280' }}>{t.date}</span>
                        <span className="text-[11px] font-mono" style={{ color: '#818cf8' }}>{t.duration_mins}m</span>
                      </div>
                      <div className="w-full bg-white/[0.04] rounded-full h-1 mt-2">
                        <div className="bg-indigo-500/60 h-1 rounded-full transition-all" style={{ width: `${Math.min((t.duration_mins / 60) * 100, 100)}%` }} />
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      <div className="flex -space-x-1.5">
                        {t.attendees.slice(0, 3).map((a, i) => (
                          <div key={i} className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white border border-[#1a1a2e]"
                            style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}
                            title={a.name || a.email}>
                            {getInitials(a.name, a.email)}
                          </div>
                        ))}
                        {t.attendees.length > 3 && (
                          <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-medium border border-[#1a1a2e]"
                            style={{ background: 'rgba(255,255,255,0.08)', color: '#9ca3af' }}>
                            +{t.attendees.length - 3}
                          </div>
                        )}
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); sendToTeam(t.id); }}
                        disabled={sending}
                        className="btn btn-primary text-[10px] py-1 px-2.5 disabled:opacity-40">
                        Send to Team
                      </button>
                    </div>
                  </div>
                </button>
              ))
            )
          )}

          {/* Actions tab */}
          {tab === 'actions' && (
            actionsLoading ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                  <span className="text-[12px]" style={{ color: '#818cf8' }}>Loading action items via OpenClaw...</span>
                </div>
                {[1, 2].map((n) => (
                  <div key={n} className="card p-4 animate-pulse">
                    <div className="flex items-center justify-between mb-3">
                      <div><div className="h-3.5 bg-white/[0.06] rounded w-48 mb-1.5" /><div className="h-2.5 bg-white/[0.04] rounded w-24" /></div>
                      <div className="h-7 bg-white/[0.06] rounded w-24" />
                    </div>
                    <div className="space-y-1.5">
                      <div className="h-2.5 bg-white/[0.04] rounded w-5/6" />
                      <div className="h-2.5 bg-white/[0.04] rounded w-4/6" />
                      <div className="h-2.5 bg-white/[0.04] rounded w-3/6" />
                    </div>
                  </div>
                ))}
              </div>
            ) : actionsError ? (
              <div className="card p-5" style={{ background: 'rgba(251,191,36,0.04)', border: '1px solid rgba(251,191,36,0.12)' }}>
                <p className="text-[12px] font-medium" style={{ color: '#fbbf24' }}>Could not load action items</p>
                <p className="text-[11px] mt-1" style={{ color: '#6b7280' }}>{actionsError}</p>
                <button onClick={() => loadActions()} className="btn btn-secondary text-[10px] py-1 mt-2">Retry</button>
              </div>
            ) : actions.length === 0 ? (
              <div className="card p-8 text-center">
                <p className="text-sm" style={{ color: '#6b7280' }}>No action items found</p>
                <p className="text-[11px] mt-1" style={{ color: '#4b5563' }}>Action items are extracted from meeting transcripts</p>
              </div>
            ) : (
              actions.map((m) => (
                <div key={m.id} className="card p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <h4 className="text-[13px] font-medium" style={{ color: '#e5e7eb' }}>{m.title}</h4>
                      <span className="text-[11px]" style={{ color: '#6b7280' }}>{m.date}</span>
                    </div>
                    <button onClick={() => sendToTeam(m.id)} disabled={sending}
                      className="btn btn-primary text-[10px] py-1 px-2.5 disabled:opacity-40">
                      Email to Team
                    </button>
                  </div>
                  <div className="space-y-1 mt-2">
                    {toLines(m.action_items).map((item, i) => (
                      <div key={i} className="flex items-start gap-2 text-[12px]" style={{ color: '#d1d5db' }}>
                        <span style={{ color: '#6b7280' }}>&#9633;</span>
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )
          )}

          {/* Search tab */}
          {tab === 'search' && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <input
                  placeholder="Search by keyword..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && search()}
                  className="flex-1"
                />
                <button onClick={search} className="btn btn-primary text-[12px]">Search</button>
                {searchResults && (
                  <button onClick={() => { setSearchResults(null); setSearchQuery(''); }} className="btn btn-ghost text-[12px]" style={{ color: '#6b7280' }}>Clear</button>
                )}
              </div>

              {searchResults === null ? (
                <div className="card p-8 text-center">
                  <p className="text-sm" style={{ color: '#6b7280' }}>Enter a keyword to search transcripts</p>
                  <p className="text-[11px] mt-1" style={{ color: '#4b5563' }}>Results are fetched via OpenClaw</p>
                </div>
              ) : searchResults.length === 0 ? (
                <div className="card p-8 text-center">
                  <p className="text-sm" style={{ color: '#6b7280' }}>No results found for &quot;{searchQuery}&quot;</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>
                    {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} for &quot;{searchQuery}&quot;
                  </p>
                  {searchResults.map((t) => (
                    <button key={t.id} onClick={() => openTranscript(t.id)}
                      className={`w-full text-left card p-4 transition-all ${selected?.id === t.id ? 'border-indigo-500/40' : ''}`}>
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <h4 className="text-[13px] font-medium" style={{ color: '#e5e7eb' }}>
                        {t.title}
                        {extractedIds.has(t.id) && (
                          <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded font-medium" style={{ background: 'rgba(34,197,94,0.1)', color: '#4ade80' }}>Extracted</span>
                        )}
                      </h4>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-[11px]" style={{ color: '#6b7280' }}>{t.date}</span>
                            <span className="text-[11px] font-mono" style={{ color: '#818cf8' }}>{t.duration_mins}m</span>
                            <span className="text-[11px]" style={{ color: '#4b5563' }}>{t.host}</span>
                          </div>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); sendToTeam(t.id); }}
                          disabled={sending}
                          className="btn btn-primary text-[10px] py-1 px-2.5 disabled:opacity-40 shrink-0 ml-3">
                          Send to Team
                        </button>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Detail panel + Quick send */}
        <div className="space-y-4">
          {/* Transcript detail */}
          {detailLoading ? (
            <div className="card p-5 space-y-4">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                <span className="text-[12px]" style={{ color: '#818cf8' }}>Loading transcript via OpenClaw...</span>
              </div>
              <div className="animate-pulse space-y-4">
                <div>
                  <div className="h-4 bg-white/[0.06] rounded w-3/4 mb-2" />
                  <div className="flex gap-3"><div className="h-2.5 bg-white/[0.04] rounded w-24" /><div className="h-2.5 bg-white/[0.04] rounded w-16" /></div>
                </div>
                <div>
                  <div className="h-2.5 bg-white/[0.04] rounded w-20 mb-2" />
                  <div className="flex gap-2">
                    <div className="w-6 h-6 rounded-full bg-white/[0.06]" />
                    <div className="w-6 h-6 rounded-full bg-white/[0.06]" />
                    <div className="w-6 h-6 rounded-full bg-white/[0.06]" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="h-2.5 bg-white/[0.04] rounded w-full" />
                  <div className="h-2.5 bg-white/[0.04] rounded w-5/6" />
                  <div className="h-2.5 bg-white/[0.04] rounded w-4/6" />
                  <div className="h-2.5 bg-white/[0.04] rounded w-3/6" />
                </div>
                <div className="flex gap-1"><div className="h-5 bg-white/[0.04] rounded w-14" /><div className="h-5 bg-white/[0.04] rounded w-14" /><div className="h-5 bg-white/[0.04] rounded w-14" /></div>
              </div>
              <p className="text-[10px]" style={{ color: '#4b5563' }}>This may take 15-30 seconds</p>
            </div>
          ) : selected ? (
            <div className="card p-5 space-y-4">
              {/* Header */}
              <div>
                <h3 className="text-sm font-semibold" style={{ color: '#e5e7eb' }}>{selected.title}</h3>
                <div className="flex items-center gap-3 mt-1 text-[11px]" style={{ color: '#6b7280' }}>
                  <span>{selected.date}</span>
                  <span className="font-mono" style={{ color: '#818cf8' }}>{selected.duration_mins}m</span>
                  {selected.host && <span>{selected.host}</span>}
                </div>
              </div>

              {/* Attendees — colored circles */}
              {selected.attendees.length > 0 && (
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider mb-2" style={{ color: '#4b5563' }}>Attendees</p>
                  <div className="flex flex-wrap gap-2">
                    {selected.attendees.map((a, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
                          style={{ background: AVATAR_COLORS[i % AVATAR_COLORS.length] }}>
                          {getInitials(a.name, a.email)}
                        </div>
                        <span className="text-[11px]" style={{ color: '#9ca3af' }}>{a.name || a.email}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Bullet Summary */}
              {selected.bullet_summary.length > 0 && (
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider mb-1" style={{ color: '#fbbf24' }}>Summary</p>
                  <div className="space-y-1">
                    {selected.bullet_summary.map((s, i) => (
                      <p key={i} className="text-[12px]" style={{ color: '#d1d5db' }}>{s}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Items */}
              {toLines(selected.action_items).length > 0 && (
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider mb-1" style={{ color: '#f87171' }}>Action Items</p>
                  <div className="space-y-1">
                    {toLines(selected.action_items).map((item, i) => (
                      <p key={i} className="text-[12px]" style={{ color: '#d1d5db' }}>&#9633; {item}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* Outline */}
              {toLines(selected.outline).length > 0 && (
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider mb-1" style={{ color: '#818cf8' }}>Outline</p>
                  <div className="space-y-1">
                    {toLines(selected.outline).map((item, i) => (
                      <p key={i} className="text-[12px]" style={{ color: '#9ca3af' }}>&#8226; {item}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* Keywords */}
              {selected.keywords.length > 0 && (
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider mb-1" style={{ color: '#4b5563' }}>Keywords</p>
                  <div className="flex flex-wrap gap-1">
                    {selected.keywords.map((k, i) => (
                      <span key={i} className="badge badge-purple text-[10px]">{k}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Transcript Viewer — collapsible, speaker-colored */}
              {selected.sentences.length > 0 && (() => {
                const speakers = [...new Set(selected.sentences.map((s) => s.speaker).filter(Boolean))];
                const getSpeakerColor = (speaker: string) =>
                  AVATAR_COLORS[speakers.indexOf(speaker) % AVATAR_COLORS.length];
                const visibleSentences = selected.sentences.slice(0, transcriptLimit);
                const remaining = selected.sentences.length - transcriptLimit;

                return (
                  <div>
                    <button
                      onClick={() => setShowTranscript(!showTranscript)}
                      className="flex items-center gap-2 w-full text-left py-1"
                    >
                      <span className="text-[10px]" style={{ color: '#6b7280' }}>{showTranscript ? '\u25BC' : '\u25B6'}</span>
                      <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: '#4b5563' }}>
                        Transcript ({selected.sentences.length} sentences)
                      </span>
                    </button>

                    {showTranscript && (
                      <div className="mt-2 max-h-96 overflow-y-auto space-y-1 pr-1" style={{ scrollbarWidth: 'thin' }}>
                        {visibleSentences.map((s, i) => (
                          <div key={i} className="flex gap-2 py-0.5">
                            {s.start !== null && (
                              <span className="text-[10px] font-mono shrink-0 w-10 text-right" style={{ color: '#4b5563' }}>
                                {formatTimestamp(s.start)}
                              </span>
                            )}
                            <span className="text-[11px] font-semibold shrink-0" style={{ color: getSpeakerColor(s.speaker), minWidth: '60px' }}>
                              {s.speaker || 'Unknown'}
                            </span>
                            <span className="text-[11px]" style={{ color: '#d1d5db' }}>{s.text}</span>
                          </div>
                        ))}
                        {remaining > 0 && (
                          <button
                            onClick={() => setTranscriptLimit((prev) => prev + 50)}
                            className="text-[11px] font-medium py-2 w-full text-center"
                            style={{ color: '#818cf8' }}>
                            Show more ({remaining} remaining)
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              {selected.url && (
                <a href={selected.url} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] font-medium block" style={{ color: '#818cf8' }}>
                  View Transcript →
                </a>
              )}

              {/* Export buttons */}
              <div className="flex gap-2 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <button onClick={exportMarkdown}
                  className="btn btn-secondary text-[10px] py-1.5 flex-1 justify-center">
                  Export Markdown
                </button>
                <button onClick={exportJSON}
                  className="btn btn-secondary text-[10px] py-1.5 flex-1 justify-center">
                  Export JSON
                </button>
              </div>

              {/* Generate Insights */}
              <div className="pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                {intelligenceLoading ? (
                  <div className="space-y-2 py-2">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                      <span className="text-[12px]" style={{ color: '#818cf8' }}>Analyzing with OpenClaw...</span>
                      <span className="text-[11px] font-mono ml-auto" style={{ color: '#4b5563' }}>{intelligenceElapsed}s</span>
                    </div>
                    <div className="w-full bg-white/[0.04] rounded-full h-1">
                      <div className="bg-indigo-500/60 h-1 rounded-full transition-all" style={{ width: `${Math.min((intelligenceElapsed / 60) * 100, 95)}%` }} />
                    </div>
                    <p className="text-[10px]" style={{ color: '#4b5563' }}>This may take 30-60 seconds</p>
                  </div>
                ) : intelligenceError ? (
                  <div className="space-y-2">
                    <div className="p-2.5 rounded-lg" style={{ background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.15)' }}>
                      <p className="text-[11px]" style={{ color: '#f87171' }}>{intelligenceError}</p>
                    </div>
                    <button onClick={() => generateIntelligence(selected.id, true)}
                      className="btn btn-secondary text-[11px] w-full justify-center">
                      Retry
                    </button>
                  </div>
                ) : intelligence ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: '#4ade80' }}>AI Meeting Intelligence</p>
                      <button onClick={() => generateIntelligence(selected.id, true)}
                        className="text-[10px] font-medium transition-colors hover:text-indigo-300"
                        style={{ color: '#4b5563' }}
                        title="Regenerate insights">
                        Refresh
                      </button>
                    </div>
                    <p className="text-[12px]" style={{ color: '#d1d5db' }}>{intelligence.executive_summary}</p>
                    {intelligence.decisions.length > 0 && (
                      <div>
                        <p className="text-[10px] font-medium mb-1" style={{ color: '#4ade80' }}>Decisions</p>
                        {intelligence.decisions.map((d, i) => (
                          <p key={i} className="text-[11px]" style={{ color: '#9ca3af' }}>- {d}</p>
                        ))}
                      </div>
                    )}
                    {intelligence.risks.length > 0 && (
                      <div>
                        <p className="text-[10px] font-medium mb-1" style={{ color: '#f87171' }}>Risks</p>
                        {intelligence.risks.map((r, i) => (
                          <p key={i} className="text-[11px]" style={{ color: '#9ca3af' }}>- {r}</p>
                        ))}
                      </div>
                    )}
                    {intelligence.notable_quotes?.length > 0 && (
                      <div>
                        <p className="text-[10px] font-medium mb-1" style={{ color: '#fbbf24' }}>Notable Quotes</p>
                        {intelligence.notable_quotes.map((q, i) => (
                          <div key={i} className="pl-3 py-1 mb-1" style={{ borderLeft: '2px solid rgba(251,191,36,0.3)' }}>
                            <p className="text-[11px] italic" style={{ color: '#d1d5db' }}>&quot;{q.quote}&quot;</p>
                            <p className="text-[10px] mt-0.5" style={{ color: '#6b7280' }}>— {q.speaker}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-medium" style={{ color: '#6b7280' }}>Sentiment:</span>
                      <span className={`badge text-[10px] ${
                        intelligence.sentiment === 'positive' ? 'badge-green' :
                        intelligence.sentiment === 'negative' ? 'badge-red' :
                        intelligence.sentiment === 'mixed' ? 'badge-yellow' : 'badge-gray'
                      }`}>{intelligence.sentiment} ({intelligence.sentiment_score}/10)</span>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => generateIntelligence(selected.id)}
                    className="btn btn-secondary text-[11px] w-full justify-center">
                    Generate Insights
                  </button>
                )}
              </div>

              {/* Send to Team */}
              <div className="pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <button onClick={() => sendToTeam(selected.id)} disabled={sending}
                  className="btn btn-primary text-[11px] w-full justify-center disabled:opacity-40">
                  {sending ? 'Sending...' : 'Send Notes to Team'}
                </button>
              </div>
            </div>
          ) : (
            <div className="card p-8 text-center">
              <p className="text-[12px]" style={{ color: '#4b5563' }}>Select a transcript to view details</p>
            </div>
          )}

          {/* Quick send to individual */}
          {selected && contacts.length > 0 && (
            <div className="card p-5">
              <p className="text-[10px] font-medium uppercase tracking-wider mb-2" style={{ color: '#6b7280' }}>Send to Individual</p>
              <div className="space-y-1.5">
                {contacts.map((c) => (
                  <button key={c.slug}
                    onClick={() => sendToRecipients(selected.id, [c.email!])}
                    disabled={sending}
                    className="w-full text-left px-3 py-2 rounded-lg text-[12px] transition-all flex items-center justify-between disabled:opacity-40"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <span style={{ color: '#d1d5db' }}>{c.slug}</span>
                    <span style={{ color: '#6b7280' }}>{c.email}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {extractResult && (
        <div className="toast">
          {extractResult}
          <button onClick={() => setExtractResult(null)} className="ml-3 opacity-60 hover:opacity-100">x</button>
        </div>
      )}
      {sendResult && (
        <div className={`toast ${sendResult.includes('Failed') ? '!bg-red-600' : ''}`}>
          {sendResult}
          <button onClick={() => setSendResult(null)} className="ml-3 opacity-60 hover:opacity-100">x</button>
        </div>
      )}
    </div>
  );
}
