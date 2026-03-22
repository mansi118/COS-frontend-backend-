'use client';

import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

type Channel = 'email' | 'whatsapp' | 'slack' | 'all';

interface ChannelStatus { configured: boolean; }
interface Contact { slug: string; email: string | null; slack_id: string | null; whatsapp: string | null; }
interface SentRecord { channel: string; to: string; status: string; time: string; }
interface ScheduleJob { time: string; name: string; to: string; description: string; }

export default function CommsPage() {
  const [emailCfg, setEmailCfg] = useState<ChannelStatus | null>(null);
  const [waCfg, setWaCfg] = useState<ChannelStatus | null>(null);
  const [slackCfg, setSlackCfg] = useState<ChannelStatus | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [schedule, setSchedule] = useState<ScheduleJob[]>([]);
  const [tab, setTab] = useState<'compose' | 'automations' | 'contacts'>('compose');
  const [channel, setChannel] = useState<Channel>('email');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [history, setHistory] = useState<SentRecord[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/email/config`).then((r) => r.json()).then((d) => setEmailCfg({ configured: d.configured })).catch(() => {});
    fetch(`${API}/api/whatsapp/config`).then((r) => r.json()).then((d) => setWaCfg({ configured: d.configured })).catch(() => {});
    fetch(`${API}/api/slack/config`).then((r) => r.json()).then((d) => setSlackCfg({ configured: d.configured })).catch(() => {});
    fetch(`${API}/api/email/schedule`).then((r) => r.json()).then((d) => setSchedule(d.jobs || [])).catch(() => {});
    // Merge contacts from all sources
    Promise.all([
      fetch(`${API}/api/email/contacts`).then((r) => r.json()).catch(() => ({ contacts: [] })),
      fetch(`${API}/api/whatsapp/contacts`).then((r) => r.json()).catch(() => ({ contacts: [] })),
    ]).then(([emailData, waData]) => {
      const map: Record<string, Contact> = {};
      for (const c of (emailData.contacts || [])) {
        map[c.slug] = { slug: c.slug, email: c.email, slack_id: c.slack_id, whatsapp: null };
      }
      for (const c of (waData.contacts || [])) {
        if (map[c.slug]) { map[c.slug].whatsapp = c.whatsapp; }
        else { map[c.slug] = { slug: c.slug, email: c.email || null, slack_id: null, whatsapp: c.whatsapp }; }
      }
      setContacts(Object.values(map));
    });
  }, []);

  const sendViaChannel = async (ch: Channel, recipient: string, subj: string, msg: string): Promise<{ success: boolean; error?: string }> => {
    try {
      if (ch === 'email') {
        const res = await fetch(`${API}/api/email/send`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: recipient, subject: subj, body: msg }),
        });
        const d = await res.json();
        return { success: d.success };
      }
      if (ch === 'whatsapp') {
        const res = await fetch(`${API}/api/whatsapp/send`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: recipient, message: msg }),
        });
        const d = await res.json();
        return { success: d.success, error: d.error };
      }
      if (ch === 'slack') {
        // If recipient looks like a user slug or ID, DM. Otherwise channel.
        const isUser = !recipient.startsWith('#') && !recipient.startsWith('C');
        const endpoint = isUser ? '/api/slack/dm' : '/api/slack/send';
        const payload = isUser
          ? { user: recipient, message: msg }
          : { channel: recipient, message: msg };
        const res = await fetch(`${API}${endpoint}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const d = await res.json();
        return { success: d.success, error: d.error };
      }
      return { success: false, error: 'Unknown channel' };
    } catch { return { success: false, error: 'Request failed' }; }
  };

  const send = async () => {
    if (!to || !body) return;
    setSending(true); setResult(null);

    if (channel === 'all') {
      const contact = contacts.find((c) => c.slug === to || c.email === to || c.whatsapp === to);
      const results: string[] = [];
      const now = new Date().toLocaleTimeString();
      if (contact) {
        if (contact.email) { const r = await sendViaChannel('email', contact.email, subject, body); results.push(`Email: ${r.success ? '✓' : '✗'}`); if (r.success) setHistory((p) => [{ channel: 'email', to: contact.email!, status: 'sent', time: now }, ...p]); }
        if (contact.whatsapp) { const r = await sendViaChannel('whatsapp', contact.whatsapp, subject, body); results.push(`WA: ${r.success ? '✓' : '✗'}`); if (r.success) setHistory((p) => [{ channel: 'whatsapp', to: contact.whatsapp!, status: 'sent', time: now }, ...p]); }
        if (contact.slack_id) { const r = await sendViaChannel('slack', contact.slug, subject, body); results.push(`Slack: ${r.success ? '✓' : '✗'}`); if (r.success) setHistory((p) => [{ channel: 'slack', to: contact.slug, status: 'sent', time: now }, ...p]); }
      } else {
        // Raw input — try to guess channel by format and send to all that match
        if (to.includes('@')) { const r = await sendViaChannel('email', to, subject, body); results.push(`Email: ${r.success ? '✓' : '✗'}`); if (r.success) setHistory((p) => [{ channel: 'email', to, status: 'sent', time: now }, ...p]); }
        if (to.startsWith('+')) { const r = await sendViaChannel('whatsapp', to, subject, body); results.push(`WA: ${r.success ? '✓' : '✗'}`); if (r.success) setHistory((p) => [{ channel: 'whatsapp', to, status: 'sent', time: now }, ...p]); }
        // Try as Slack slug/channel
        const r = await sendViaChannel('slack', to, subject, body); results.push(`Slack: ${r.success ? '✓' : '✗'}`); if (r.success) setHistory((p) => [{ channel: 'slack', to, status: 'sent', time: now }, ...p]);
      }
      setResult(results.join(' · ') || 'Could not determine channels for this recipient');
    } else {
      const r = await sendViaChannel(channel, to, subject, body);
      if (r.success) {
        setResult(`Sent via ${channel}`);
        setHistory((p) => [{ channel, to, status: 'sent', time: new Date().toLocaleTimeString() }, ...p]);
      } else { setResult(`Failed: ${r.error}`); }
    }
    setSending(false);
    setTimeout(() => setResult(null), 4000);
  };

  const runAutomation = async (action: string, label: string, channels: Channel[] = ['email']) => {
    setSending(true); setRunningAction(label); setResult(null);
    const results: string[] = [];
    for (const ch of channels) {
      try {
        let url = '';
        if (ch === 'email') url = `${API}/api/taskflow/notify/briefing`;
        else if (ch === 'whatsapp') url = `${API}/api/whatsapp/briefing`;
        else if (ch === 'slack') url = `${API}/api/slack/briefing`;
        if (action === 'overdue') {
          if (ch === 'email') url = `${API}/api/taskflow/notify/overdue`;
          else if (ch === 'whatsapp') url = `${API}/api/whatsapp/overdue`;
          else if (ch === 'slack') url = `${API}/api/slack/briefing`; // no dedicated overdue for slack, send briefing instead
        }
        if (!url) continue;
        const res = await fetch(url, { method: 'POST' });
        const d = await res.json();
        const ok = d.success || d.sent || d.status === 'sent';
        results.push(`${ch}: ${ok ? '✓' : '✗'}`);
        if (ok) setHistory((p) => [{ channel: ch, to: 'team', status: 'sent', time: new Date().toLocaleTimeString() }, ...p]);
      } catch { results.push(`${ch}: ✗`); }
    }
    setResult(`${label}: ${results.join(' · ')}`);
    setSending(false);
    setRunningAction(null);
    setTimeout(() => setResult(null), 5000);
  };

  const templates = [
    { name: 'Follow-up Reminder', subject: 'Reminder: Pending Action Item', body: '## Pending Action Item\n\nFriendly reminder about a pending follow-up.\n\n- [ ] Review and update status\n- [ ] Respond by EOD\n\n---\n\n**Priority:** P1' },
    { name: 'Meeting Summary', subject: 'Meeting Notes & Action Items', body: '## Meeting Notes\n\n**Date:** Today\n\n### Decisions\n- Decision 1\n\n### Action Items\n- [ ] Action A\n- [ ] Action B' },
    { name: 'Sprint Update', subject: 'Sprint Progress', body: '## Sprint Update\n\n### Completed\n- [x] Task 1\n\n### In Progress\n- [ ] Task 2\n\n### Blocked\n- **Blocker:** Description' },
    { name: 'Quick Alert', subject: 'Alert', body: '⚠️ **Alert**\n\nImmediate attention required.\n\n---\n\n_Sent from NeuralEDGE CoS_' },
  ];

  const channelIcon = (ch: string) => ch === 'email' ? '✉' : ch === 'whatsapp' ? '💬' : ch === 'slack' ? '#' : '📡';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold" style={{ color: '#e5e7eb' }}>Team Comms</h2>
          <p className="text-[12px] mt-0.5" style={{ color: '#6b7280' }}>Unified communications — Slack · WhatsApp · Email</p>
        </div>
        <div className="flex items-center gap-3">
          {[
            { name: 'Slack', cfg: slackCfg },
            { name: 'WhatsApp', cfg: waCfg },
            { name: 'Email', cfg: emailCfg },
          ].map((ch) => (
            <div key={ch.name} className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${ch.cfg?.configured ? 'bg-emerald-400' : 'bg-red-400'}`} />
              <span className="text-[10px]" style={{ color: ch.cfg?.configured ? '#4ade80' : '#f87171' }}>{ch.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)' }}>
        {(['compose', 'automations', 'contacts'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className="px-4 py-1.5 rounded-md text-[12px] font-medium transition-all capitalize"
            style={tab === t ? { background: 'rgba(99,102,241,0.15)', color: '#818cf8' } : { color: '#6b7280' }}>
            {t}
          </button>
        ))}
      </div>

      {/* Compose */}
      {tab === 'compose' && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 space-y-4">
            <div className="card p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold" style={{ color: '#e5e7eb' }}>Compose</h3>
                <button onClick={() => setShowTemplates(!showTemplates)} className="btn btn-secondary text-[11px] py-1.5">Templates</button>
              </div>

              {showTemplates && (
                <div className="grid grid-cols-2 gap-2">
                  {templates.map((t) => (
                    <button key={t.name} onClick={() => { setSubject(t.subject); setBody(t.body); setShowTemplates(false); }}
                      className="text-left p-3 rounded-lg transition-all" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <p className="text-[12px] font-medium" style={{ color: '#d1d5db' }}>{t.name}</p>
                    </button>
                  ))}
                </div>
              )}

              {/* Channel Picker */}
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>Channel</label>
                <div className="flex gap-1.5 mt-1">
                  {(['email', 'whatsapp', 'slack', 'all'] as const).map((ch) => (
                    <button key={ch} onClick={() => setChannel(ch)}
                      className="px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all capitalize"
                      style={channel === ch
                        ? { background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)' }
                        : { background: 'rgba(255,255,255,0.03)', color: '#6b7280', border: '1px solid rgba(255,255,255,0.06)' }
                      }>
                      {channelIcon(ch)} {ch === 'all' ? 'All Channels' : ch}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>
                  To {channel === 'email' ? '(email)' : channel === 'whatsapp' ? '(phone +91...)' : channel === 'slack' ? '(slug or #channel)' : '(contact slug)'}
                </label>
                <input placeholder={channel === 'email' ? 'email@example.com' : channel === 'whatsapp' ? '+919876543210' : channel === 'slack' ? 'yatharth or #daily_update' : 'yatharth'}
                  value={to} onChange={(e) => setTo(e.target.value)} className="w-full mt-1" />
              </div>
              {(channel === 'email' || channel === 'all') && (
                <div>
                  <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>Subject (email)</label>
                  <input placeholder="Email subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full mt-1" />
                </div>
              )}
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>
                  Message <span style={{ color: '#4b5563' }}>— markdown: **bold** *italic* - lists - [ ] checklists</span>
                </label>
                <textarea placeholder="Write your message..." value={body} onChange={(e) => setBody(e.target.value)}
                  className="w-full mt-1 font-mono text-[13px]" rows={10} style={{ lineHeight: '1.6' }} />
              </div>

              <div className="flex items-center justify-between pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                <p className="text-[10px]" style={{ color: '#4b5563' }}>
                  {channel === 'email' ? 'Markdown → branded HTML' : channel === 'slack' ? 'Markdown → Slack mrkdwn' : channel === 'whatsapp' ? 'WhatsApp *bold* _italic_' : 'Auto-formatted per channel'}
                </p>
                <button onClick={send} disabled={sending || !to || !body} className="btn btn-primary text-[12px] disabled:opacity-40">
                  {sending ? 'Sending...' : channel === 'all' ? 'Send All Channels' : `Send via ${channel}`}
                </button>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <div className="card p-5">
              <h3 className="text-sm font-semibold mb-3" style={{ color: '#e5e7eb' }}>Team</h3>
              <div className="space-y-1.5">
                {contacts.map((c) => {
                  const hasChannel = channel === 'all' || channel === 'slack'
                    ? true
                    : channel === 'email' ? !!c.email
                    : channel === 'whatsapp' ? !!c.whatsapp
                    : true;
                  const selectTo = () => {
                    if (channel === 'email') setTo(c.email || '');
                    else if (channel === 'whatsapp') setTo(c.whatsapp || '');
                    else setTo(c.slug);
                  };
                  return (
                    <button key={c.slug}
                      onClick={() => { if (hasChannel) selectTo(); else setResult(`${c.slug} has no ${channel} configured`); }}
                      className="w-full text-left px-3 py-2 rounded-lg text-[12px] transition-all flex items-center justify-between"
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', opacity: hasChannel ? 1 : 0.4 }}>
                      <span style={{ color: '#d1d5db' }}>{c.slug}</span>
                      <div className="flex gap-1">
                        {c.email && <span className="text-[9px] px-1 rounded" style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8' }}>✉</span>}
                        {c.slack_id && <span className="text-[9px] px-1 rounded" style={{ background: 'rgba(34,197,94,0.1)', color: '#4ade80' }}>#</span>}
                        {c.whatsapp && <span className="text-[9px] px-1 rounded" style={{ background: 'rgba(34,197,94,0.1)', color: '#4ade80' }}>💬</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="card p-5">
              <h3 className="text-sm font-semibold mb-3" style={{ color: '#e5e7eb' }}>Recent</h3>
              {history.length === 0 ? (
                <p className="text-[12px]" style={{ color: '#4b5563' }}>No messages sent yet</p>
              ) : (
                <div className="space-y-1.5 max-h-48 overflow-auto">
                  {history.slice(0, 12).map((h, i) => (
                    <div key={i} className="flex items-center justify-between text-[11px] px-2 py-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)' }}>
                      <div className="flex items-center gap-1.5">
                        <span>{channelIcon(h.channel)}</span>
                        <span style={{ color: '#d1d5db' }}>{h.to}</span>
                      </div>
                      <span style={{ color: '#4b5563' }}>{h.time}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Automations */}
      {tab === 'automations' && (
        <div className="space-y-6">
          {schedule.length > 0 && (
            <div className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold" style={{ color: '#e5e7eb' }}>Auto-Schedule (Running)</h3>
                <span className="badge badge-green text-[10px]">Active</span>
              </div>
              <div className="space-y-2">
                {schedule.map((job, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
                    <span className="text-[13px] font-mono font-bold shrink-0" style={{ color: '#818cf8', width: '50px' }}>{job.time}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium" style={{ color: '#d1d5db' }}>{job.name}</p>
                      <p className="text-[10px] truncate" style={{ color: '#6b7280' }}>{job.description}</p>
                    </div>
                    <span className="text-[10px] shrink-0" style={{ color: '#4b5563' }}>{job.to}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="section-label">Manual Triggers</p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {[
                { name: 'Morning Briefing', desc: 'Send daily briefing to team', action: 'briefing', channels: ['email', 'slack', 'whatsapp'] as Channel[] },
                { name: 'Overdue Alerts', desc: 'Per-person overdue task alerts', action: 'overdue', channels: ['email', 'whatsapp'] as Channel[] },
                { name: 'Briefing → Slack Only', desc: 'Send briefing card to #daily-update', action: 'briefing', channels: ['slack'] as Channel[] },
                { name: 'Briefing → WhatsApp Only', desc: 'Send briefing to CEO WhatsApp', action: 'briefing', channels: ['whatsapp'] as Channel[] },
              ].map((a) => (
                <div key={a.name} className="card p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="text-[13px] font-semibold" style={{ color: '#e5e7eb' }}>{a.name}</h4>
                      <p className="text-[11px] mt-1" style={{ color: '#6b7280' }}>{a.desc}</p>
                      <div className="flex gap-1 mt-1.5">
                        {a.channels.map((ch) => (
                          <span key={ch} className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.04)', color: '#9ca3af' }}>{channelIcon(ch)} {ch}</span>
                        ))}
                      </div>
                    </div>
                    <button onClick={() => runAutomation(a.action, a.name, a.channels)} disabled={runningAction === a.name}
                      className="btn btn-primary text-[11px] py-1.5 shrink-0 disabled:opacity-40">
                      {runningAction === a.name ? '...' : 'Run'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {history.length > 0 && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold mb-3" style={{ color: '#e5e7eb' }}>Activity</h3>
              <div className="space-y-1.5 max-h-48 overflow-auto">
                {history.slice(0, 15).map((h, i) => (
                  <div key={i} className="flex items-center justify-between text-[11px] px-2 py-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <div className="flex items-center gap-1.5">
                      <span>{channelIcon(h.channel)}</span>
                      <span style={{ color: '#d1d5db' }}>{h.to}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="badge badge-green text-[9px]">{h.status}</span>
                      <span style={{ color: '#4b5563' }}>{h.time}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Contacts */}
      {tab === 'contacts' && (
        <div className="card overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                {['Name', 'Email', 'Slack ID', 'WhatsApp'].map((h) => (
                  <th key={h} className="text-left px-5 py-3 text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#6b7280' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.slug}>
                  <td className="px-5 py-3 font-medium" style={{ color: '#e5e7eb' }}>{c.slug}</td>
                  <td className="px-5 py-3" style={{ color: c.email ? '#9ca3af' : '#4b5563' }}>{c.email || '—'}</td>
                  <td className="px-5 py-3 font-mono text-[11px]" style={{ color: c.slack_id ? '#9ca3af' : '#4b5563' }}>{c.slack_id || '—'}</td>
                  <td className="px-5 py-3" style={{ color: c.whatsapp ? '#9ca3af' : '#4b5563' }}>{c.whatsapp || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result && (
        <div className={`toast ${result.includes('Failed') || result.includes('✗') ? '!bg-red-600' : ''}`}>
          {result}
          <button onClick={() => setResult(null)} className="ml-3 opacity-60 hover:opacity-100">x</button>
        </div>
      )}
    </div>
  );
}
