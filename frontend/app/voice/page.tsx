'use client';

import { useEffect, useState } from 'react';
import useWebSocket from '@/components/useWebSocket';
import useVoiceRecorder from '@/hooks/useVoiceRecorder';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface VoiceUpdate {
  vu_id: string;
  who: string | null;
  who_name?: string | null;
  type: string;
  audio_url: string | null;
  audio_format?: string;
  duration_sec?: number | null;
  transcript?: string | null;
  summary?: string | null;
  routed_to?: Array<{ type: string; id: string }>;
  listened_by?: string[];
  priority?: string;
  tags?: string[];
  created_at?: string;
}

interface VoiceStats {
  total: number;
  today: number;
  unlistened: number;
  by_type: Record<string, number>;
}

const AVATAR_COLORS = ['#818cf8', '#f472b6', '#34d399', '#fbbf24', '#fb923c', '#a78bfa', '#22d3ee', '#f87171'];
function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const typeConfig: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  standup: { label: 'Standup', color: '#818cf8', bg: 'rgba(99,102,241,0.1)', icon: '📝' },
  meeting_note: { label: 'Meeting', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', icon: '📋' },
  blocker: { label: 'Blocker', color: '#f87171', bg: 'rgba(239,68,68,0.1)', icon: '🔴' },
  general: { label: 'General', color: '#9ca3af', bg: 'rgba(255,255,255,0.04)', icon: '🎙' },
};

function formatDuration(sec: number | null | undefined): string {
  if (!sec) return '0:00';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatTime(iso: string | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  } catch { return ''; }
}

export default function VoiceFeedPage() {
  const [updates, setUpdates] = useState<VoiceUpdate[]>([]);
  const [stats, setStats] = useState<VoiceStats | null>(null);
  const [teamMembers, setTeamMembers] = useState<Array<{ slug: string; name: string }>>([]);
  const [filterWho, setFilterWho] = useState('');
  const [filterType, setFilterType] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [routing, setRouting] = useState<string | null>(null);
  const [showRecorder, setShowRecorder] = useState(false);
  const [recWho, setRecWho] = useState('');
  const [recType, setRecType] = useState('general');
  const [recTags, setRecTags] = useState('');
  const { lastMessage } = useWebSocket();
  const recorder = useVoiceRecorder();

  const load = () => {
    let url = `${API}/api/voice/feed?limit=30`;
    if (filterWho) url += `&who=${filterWho}`;
    if (filterType) url += `&type=${filterType}`;
    fetch(url).then((r) => r.json()).then((d) => setUpdates(d.updates || [])).catch(() => {});
    fetch(`${API}/api/voice/stats`).then((r) => r.json()).then(setStats).catch(() => {});
    fetch(`${API}/api/pulse`).then((r) => r.json()).then((d) => {
      if (d.team) setTeamMembers(d.team.map((m: { slug: string; name: string }) => ({ slug: m.slug, name: m.name })));
    }).catch(() => {});
  };

  useEffect(() => { load(); }, [filterWho, filterType]);
  useEffect(() => { if (lastMessage?.type === 'voice_update') load(); }, [lastMessage]);

  const submitRecording = async () => {
    if (!recWho) { setResult('Select a team member'); return; }
    const res = await recorder.submitVoice(recWho, recType, recTags);
    if (res.vu_id) {
      setResult(`Voice update ${res.vu_id} uploaded — transcribing...`);
      setShowRecorder(false);
      setRecWho('');
      setRecType('general');
      setRecTags('');
      load();
    } else {
      setResult(`Failed: ${res.error}`);
    }
    setTimeout(() => setResult(null), 5000);
  };

  const routeVoice = async (vuId: string, targetType: string) => {
    setRouting(vuId);
    try {
      const formData = new FormData();
      formData.append('target_type', targetType);
      const res = await fetch(`${API}/api/voice/${vuId}/route`, { method: 'POST', body: formData });
      const data = await res.json();
      if (data.routed_to) {
        setResult(`Routed to ${targetType}`);
        load();
      } else {
        setResult(data.error || 'Routing failed');
      }
    } catch { setResult('Failed'); }
    finally { setRouting(null); setTimeout(() => setResult(null), 4000); }
  };

  const markListened = async (vuId: string) => {
    // Use "ceo" as the listener for now
    await fetch(`${API}/api/voice/${vuId}/listened?user=ceo`, { method: 'PATCH' });
    load();
  };

  const uniqueWhos = teamMembers.length > 0
    ? teamMembers
    : Array.from(new Set(updates.map((v) => v.who).filter(Boolean))).map((w) => ({ slug: w!, name: w! }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold" style={{ color: '#e5e7eb' }}>Voice Feed</h2>
          <p className="text-[12px] mt-0.5" style={{ color: '#6b7280' }}>
            {stats ? `${stats.total} updates · ${stats.unlistened} unheard` : 'Loading...'}
          </p>
        </div>
        <button onClick={() => setShowRecorder(!showRecorder)} className="btn btn-primary text-[12px]">
          {showRecorder ? 'Close Recorder' : '🎙 Record Update'}
        </button>
      </div>

      {/* Recorder */}
      {showRecorder && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold mb-3" style={{ color: '#e5e7eb' }}>Record Voice Update</h3>

          <div className="grid grid-cols-3 gap-3 mb-4">
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>Who *</label>
              <select value={recWho} onChange={(e) => setRecWho(e.target.value)} className="w-full mt-1">
                <option value="">Select person</option>
                {uniqueWhos.map((w) => <option key={w.slug} value={w.slug}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>Type</label>
              <select value={recType} onChange={(e) => setRecType(e.target.value)} className="w-full mt-1">
                <option value="standup">Standup</option>
                <option value="meeting_note">Meeting Note</option>
                <option value="blocker">Blocker</option>
                <option value="general">General</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>Tags</label>
              <input placeholder="comma-separated" value={recTags} onChange={(e) => setRecTags(e.target.value)} className="w-full mt-1" />
            </div>
          </div>

          {/* Recording controls */}
          <div className="flex items-center gap-3 p-4 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
            {!recorder.isRecording && !recorder.audioBlob && (
              <button onClick={recorder.startRecording}
                className="w-12 h-12 rounded-full flex items-center justify-center transition-all hover:scale-105"
                style={{ background: 'rgba(239,68,68,0.15)', border: '2px solid rgba(239,68,68,0.4)' }}>
                <div className="w-4 h-4 rounded-full bg-red-500" />
              </button>
            )}
            {recorder.isRecording && (
              <>
                <button onClick={recorder.stopRecording}
                  className="w-12 h-12 rounded-full flex items-center justify-center transition-all hover:scale-105"
                  style={{ background: 'rgba(239,68,68,0.2)', border: '2px solid rgba(239,68,68,0.5)' }}>
                  <div className="w-4 h-4 rounded-sm bg-red-500" />
                </button>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    <span className="text-[13px] font-mono font-bold" style={{ color: '#f87171' }}>
                      {Math.floor(recorder.duration / 60)}:{(recorder.duration % 60).toString().padStart(2, '0')}
                    </span>
                    <span className="text-[10px]" style={{ color: '#6b7280' }}>/ 3:00 max</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full mt-2 overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div className="h-full rounded-full bg-red-500 transition-all" style={{ width: `${(recorder.duration / 180) * 100}%` }} />
                  </div>
                </div>
              </>
            )}
            {recorder.audioBlob && !recorder.isRecording && (
              <>
                <audio src={recorder.audioUrl || undefined} controls className="flex-1 h-10" style={{ maxWidth: '300px' }} />
                <span className="text-[12px] font-mono" style={{ color: '#9ca3af' }}>{formatDuration(recorder.duration)}</span>
                <button onClick={recorder.discardRecording} className="btn btn-secondary text-[11px] py-1.5">Discard</button>
                <button onClick={submitRecording} disabled={recorder.submitting || !recWho}
                  className="btn btn-primary text-[11px] py-1.5 disabled:opacity-40">
                  {recorder.submitting ? 'Uploading...' : 'Submit'}
                </button>
              </>
            )}
            {!recorder.isRecording && !recorder.audioBlob && (
              <span className="text-[12px]" style={{ color: '#6b7280' }}>Click the red button to start recording</span>
            )}
          </div>

          {recorder.error && (
            <p className="text-[11px] mt-2" style={{ color: '#f87171' }}>{recorder.error}</p>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2">
        <select value={filterWho} onChange={(e) => setFilterWho(e.target.value)} className="text-[12px]">
          <option value="">All People</option>
          {uniqueWhos.map((w) => <option key={w.slug} value={w.slug}>{w.name}</option>)}
        </select>
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="text-[12px]">
          <option value="">All Types</option>
          <option value="standup">Standup</option>
          <option value="meeting_note">Meeting Note</option>
          <option value="blocker">Blocker</option>
          <option value="general">General</option>
        </select>
      </div>

      {/* Voice Cards */}
      {updates.length > 0 ? (
        <div className="space-y-3">
          {updates.map((vu) => {
            const displayName = vu.who_name || vu.who || 'Unknown';
            const ac = getAvatarColor(displayName);
            const tc = typeConfig[vu.type] || typeConfig.general;
            const isNew = !(vu.listened_by || []).includes('ceo');
            const hasTranscript = !!vu.transcript;
            const routes = vu.routed_to || [];

            return (
              <div key={vu.vu_id} className={`card p-0 overflow-hidden ${isNew ? 'border-l-2 border-l-indigo-500' : ''}`}>
                {/* Header */}
                <div className="px-5 py-3.5 flex items-center justify-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center text-[11px] font-bold shrink-0"
                      style={{ background: ac + '20', color: ac, border: `1.5px solid ${ac}35` }}>
                      {getInitials(displayName)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-[13px] font-semibold" style={{ color: ac }}>{displayName}</h4>
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-medium" style={{ background: tc.bg, color: tc.color }}>
                          {tc.icon} {tc.label}
                        </span>
                        {isNew && (
                          <span className="text-[8px] px-1.5 py-0.5 rounded font-bold" style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8' }}>NEW</span>
                        )}
                      </div>
                      <p className="text-[10px] mt-0.5" style={{ color: '#6b7280' }}>
                        {formatTime(vu.created_at)} · {formatDuration(vu.duration_sec)} · {vu.vu_id}
                      </p>
                    </div>
                  </div>
                  {vu.priority && vu.priority !== 'P2' && (
                    <span className={`text-[10px] px-2 py-0.5 rounded-md font-medium priority-${vu.priority}`}>{vu.priority}</span>
                  )}
                </div>

                {/* Audio player + transcript */}
                <div className="px-5 py-4 space-y-3">
                  {/* Audio player */}
                  {vu.audio_url && (
                    <audio
                      src={vu.audio_url}
                      controls
                      onPlay={() => markListened(vu.vu_id)}
                      className="w-full h-10"
                      style={{ borderRadius: '8px' }}
                    />
                  )}

                  {/* Transcript */}
                  {hasTranscript ? (
                    <p className="text-[12px] leading-relaxed" style={{ color: '#d1d5db' }}>
                      {vu.transcript}
                    </p>
                  ) : (
                    <div className="flex items-center gap-2 py-2">
                      <div className="w-3 h-3 rounded-full bg-indigo-500 animate-pulse" />
                      <span className="text-[11px]" style={{ color: '#818cf8' }}>Transcribing...</span>
                    </div>
                  )}

                  {/* Summary */}
                  {vu.summary && (
                    <p className="text-[11px] italic" style={{ color: '#6b7280' }}>{vu.summary}</p>
                  )}

                  {/* Routed items */}
                  {routes.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-[10px]" style={{ color: '#4b5563' }}>Routed:</span>
                      {routes.map((r, i) => (
                        <a key={i}
                          href={r.type === 'followup' ? '/followups' : r.type === 'task' ? '/taskflow' : '#'}
                          className="text-[9px] font-mono px-1.5 py-0.5 rounded transition-opacity hover:opacity-80"
                          style={{
                            background: r.type === 'followup' ? 'rgba(99,102,241,0.1)' : 'rgba(245,158,11,0.1)',
                            color: r.type === 'followup' ? '#818cf8' : '#f59e0b',
                          }}>
                          {r.id}
                        </a>
                      ))}
                    </div>
                  )}

                  {/* Tags */}
                  {(vu.tags || []).length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {vu.tags!.map((tag) => (
                        <span key={tag} className="badge badge-gray text-[9px]">{tag}</span>
                      ))}
                    </div>
                  )}

                  {/* Quick actions */}
                  {hasTranscript && routes.length === 0 && (
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => routeVoice(vu.vu_id, 'followup')} disabled={routing === vu.vu_id}
                        className="text-[10px] px-2.5 py-1 rounded-md font-medium transition-colors hover:bg-indigo-500/10 disabled:opacity-40"
                        style={{ color: '#818cf8', border: '1px solid rgba(99,102,241,0.2)' }}>
                        {routing === vu.vu_id ? '...' : '+ Create Follow-up'}
                      </button>
                      <button onClick={() => routeVoice(vu.vu_id, 'task')} disabled={routing === vu.vu_id}
                        className="text-[10px] px-2.5 py-1 rounded-md font-medium transition-colors hover:bg-amber-500/10 disabled:opacity-40"
                        style={{ color: '#f59e0b', border: '1px solid rgba(245,158,11,0.2)' }}>
                        {routing === vu.vu_id ? '...' : '+ Create Task'}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card p-12 text-center">
          <p className="text-sm" style={{ color: '#6b7280' }}>No voice updates yet</p>
          <p className="text-[11px] mt-1" style={{ color: '#4b5563' }}>Click &quot;Record Update&quot; to get started</p>
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
