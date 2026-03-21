'use client';

import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface Competitor { name: string; tier: number; latest: string; date: string; relevance: number; signals: string[]; }
interface News { headline: string; source: string; date: string; category: string; relevance: number; }
interface Opportunity { title: string; source: string; industry: string; value: string; confidence: number; date: string; }
interface Alert { level: string; competitor?: string; event?: string; type?: string; headline?: string; date: string; }

export default function IntelPage() {
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [news, setNews] = useState<News[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [watchlist, setWatchlist] = useState<Record<string, string[]>>({});
  const [tab, setTab] = useState<'overview' | 'competitors' | 'opportunities'>('overview');

  useEffect(() => {
    fetch(`${API}/api/intel/dashboard`).then((r) => r.json()).then((d) => {
      setCompetitors(d.competitors || []);
      setNews(d.industry || []);
      setOpportunities(d.opportunities || []);
      setWatchlist(d.watchlist || {});
    }).catch(() => {});
    fetch(`${API}/api/intel/alerts`).then((r) => r.json()).then((d) => setAlerts(d.alerts || [])).catch(() => {});
  }, []);

  const categoryIcon: Record<string, string> = { market: '📈', regulation: '⚖️', technology: '🤖', opportunity: '💡', hiring: '👥' };
  const signalColor: Record<string, string> = { funding: 'badge-green', product_launch: 'badge-blue', expansion: 'badge-yellow', open_source: 'badge-purple', enterprise: 'badge-blue', hiring: 'badge-gray' };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold" style={{ color: '#e5e7eb' }}>Competitive Intelligence</h2>
          <p className="text-[12px] mt-0.5" style={{ color: '#6b7280' }}>Market monitoring, competitor tracking, opportunity detection</p>
        </div>
        <span className="badge badge-yellow text-[10px]">Placeholder Data</span>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="card p-4" style={{ background: 'rgba(249,115,22,0.06)', borderColor: 'rgba(249,115,22,0.15)' }}>
          <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: '#fb923c' }}>Material Events</p>
          {alerts.map((a, i) => (
            <p key={i} className="text-[12px] mb-1" style={{ color: '#d1d5db' }}>
              {a.level === 'high' ? '🔴' : '🟡'} <span className="font-medium">{a.competitor || a.type}</span>: {a.event || a.headline}
            </p>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)' }}>
        {(['overview', 'competitors', 'opportunities'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className="px-4 py-1.5 rounded-md text-[12px] font-medium transition-all capitalize"
            style={tab === t ? { background: 'rgba(99,102,241,0.15)', color: '#818cf8' } : { color: '#6b7280' }}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Competitor Activity */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold mb-4" style={{ color: '#e5e7eb' }}>Competitor Activity</h3>
            <div className="space-y-3">
              {competitors.map((c) => (
                <div key={c.name} className="p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[13px] font-medium" style={{ color: '#e5e7eb' }}>{c.name}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="badge badge-gray text-[9px]">Tier {c.tier}</span>
                      <span className="text-[10px] font-mono" style={{ color: c.relevance >= 8 ? '#f87171' : c.relevance >= 6 ? '#facc15' : '#6b7280' }}>{c.relevance}/10</span>
                    </div>
                  </div>
                  <p className="text-[12px] mb-2" style={{ color: '#9ca3af' }}>{c.latest}</p>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px]" style={{ color: '#4b5563' }}>{c.date}</span>
                    {c.signals.map((s) => (
                      <span key={s} className={`badge text-[9px] ${signalColor[s] || 'badge-gray'}`}>{s.replace('_', ' ')}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Industry News */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold mb-4" style={{ color: '#e5e7eb' }}>Industry Intelligence</h3>
            <div className="space-y-3">
              {news.map((n, i) => (
                <div key={i} className="p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <div className="flex items-start gap-2">
                    <span className="text-lg shrink-0">{categoryIcon[n.category] || '📰'}</span>
                    <div>
                      <p className="text-[12px] font-medium" style={{ color: '#d1d5db' }}>{n.headline}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px]" style={{ color: '#6b7280' }}>{n.source}</span>
                        <span className="text-[10px]" style={{ color: '#4b5563' }}>{n.date}</span>
                        <span className={`badge text-[9px] ${n.category === 'regulation' ? 'badge-red' : n.category === 'technology' ? 'badge-blue' : 'badge-green'}`}>{n.category}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'competitors' && (
        <div className="space-y-6">
          {Object.entries(watchlist).map(([tier, names]) => (
            <div key={tier}>
              <p className="text-[11px] font-medium uppercase tracking-wider mb-2" style={{ color: '#6b7280' }}>
                {tier.replace('_', ' ')} — {tier === 'tier_1' ? 'Direct Competitors' : tier === 'tier_2' ? 'AI Agent Platforms' : 'Big Tech AI'}
              </p>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                {names.map((name) => {
                  const detail = competitors.find((c) => c.name === name);
                  return (
                    <div key={name} className="card p-4">
                      <h4 className="text-[13px] font-semibold" style={{ color: '#e5e7eb' }}>{name}</h4>
                      {detail ? (
                        <>
                          <p className="text-[11px] mt-1" style={{ color: '#9ca3af' }}>{detail.latest}</p>
                          <div className="flex gap-1 mt-2">
                            {detail.signals.map((s) => (
                              <span key={s} className={`badge text-[9px] ${signalColor[s] || 'badge-gray'}`}>{s.replace('_', ' ')}</span>
                            ))}
                          </div>
                        </>
                      ) : (
                        <p className="text-[11px] mt-1" style={{ color: '#4b5563' }}>No recent activity tracked</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'opportunities' && (
        <div className="space-y-3">
          {opportunities.map((o, i) => (
            <div key={i} className="card p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="text-[13px] font-semibold" style={{ color: '#e5e7eb' }}>{o.title}</h4>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[11px]" style={{ color: '#6b7280' }}>{o.source}</span>
                    <span className="badge badge-blue text-[10px]">{o.industry}</span>
                    <span className="text-[11px]" style={{ color: '#4b5563' }}>{o.date}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[14px] font-bold tabular-nums" style={{ color: '#e5e7eb' }}>{o.value}</p>
                  <div className="flex items-center gap-1 mt-1 justify-end">
                    <span className="text-[10px]" style={{ color: '#6b7280' }}>Confidence:</span>
                    <span className="text-[11px] font-semibold" style={{ color: o.confidence >= 7 ? '#4ade80' : o.confidence >= 5 ? '#facc15' : '#f87171' }}>{o.confidence}/10</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
          {opportunities.length === 0 && (
            <div className="card p-8 text-center">
              <p className="text-sm" style={{ color: '#6b7280' }}>No opportunities detected yet</p>
            </div>
          )}
        </div>
      )}

      <p className="text-[10px] text-center" style={{ color: '#4b5563' }}>
        Placeholder data — connect web_search + web_fetch for live competitive scanning
      </p>
    </div>
  );
}
