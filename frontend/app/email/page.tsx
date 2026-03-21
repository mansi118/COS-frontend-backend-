'use client';

import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface EmailConfig {
  from: string;
  host: string;
  port: number;
  configured: boolean;
}

interface Contact {
  slug: string;
  email: string | null;
  slack_id: string;
  slack: string;
}

interface SentRecord {
  to: string;
  subject: string;
  status: string;
  time: string;
}

export default function EmailPage() {
  const [config, setConfig] = useState<EmailConfig | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [executingAction, setExecutingAction] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [history, setHistory] = useState<SentRecord[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [tab, setTab] = useState<'compose' | 'automate'>('compose');
  const [schedule, setSchedule] = useState<Array<{time: string; name: string; to: string; description: string}>>([]);
  const [gmailConfig, setGmailConfig] = useState<{configured: boolean; note: string | null} | null>(null);
  const [gatewayStatus, setGatewayStatus] = useState<{connected: boolean; url: string; error?: string} | null>(null);

  useEffect(() => {
    fetch(`${API}/api/email/config`).then((r) => r.json()).then(setConfig).catch(() => {});
    fetch(`${API}/api/email/contacts`).then((r) => r.json()).then((d) => setContacts(d.contacts || [])).catch(() => {});
    fetch(`${API}/api/email/schedule`).then((r) => r.json()).then((d) => setSchedule(d.jobs || [])).catch(() => {});
    fetch(`${API}/api/gmail/config`).then((r) => r.json()).then(setGmailConfig).catch(() => {});
    fetch(`${API}/api/gateway/status`).then((r) => r.json()).then(setGatewayStatus).catch(() => {});
  }, []);

  const send = async () => {
    if (!to || !subject || !body) return;
    setSending(true);
    setResult(null);
    try {
      const res = await fetch(`${API}/api/email/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, subject, body }),
      });
      const data = await res.json();
      if (data.success) {
        setResult('Email sent successfully!');
        setHistory((prev) => [{ to, subject, status: 'sent', time: new Date().toLocaleTimeString() }, ...prev]);
        setTo(''); setSubject(''); setBody('');
      } else {
        setResult(`Failed: ${data.error}`);
      }
    } catch {
      setResult('Failed to send');
    } finally {
      setSending(false);
      setTimeout(() => setResult(null), 4000);
    }
  };

  const sendToAll = async () => {
    if (!subject || !body) return;
    const emails = emailContacts.map((c) => c.email!);
    setSending(true);
    setResult(null);
    try {
      const res = await fetch(`${API}/api/email/send-multi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: emails, subject, body }),
      });
      const data = await res.json();
      setResult(`Sent to ${data.sent}/${data.total} team members`);
      for (const e of emails) {
        setHistory((prev) => [{ to: e, subject, status: 'sent', time: new Date().toLocaleTimeString() }, ...prev]);
      }
    } catch {
      setResult('Failed');
    } finally {
      setSending(false);
      setTimeout(() => setResult(null), 4000);
    }
  };

  const notifyByPriority = async (priority: string, subj: string, bd: string) => {
    setSending(true);
    setResult(null);
    try {
      const res = await fetch(`${API}/api/email/notify?priority=${priority}&subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(bd)}`, { method: 'POST' });
      const data = await res.json();
      setResult(`${priority} notification: ${data.sent} emails sent`);
      if (data.results) {
        for (const r of data.results) {
          if (r.success) setHistory((prev) => [{ to: r.email, subject: subj, status: 'sent', time: new Date().toLocaleTimeString() }, ...prev]);
        }
      }
    } catch {
      setResult('Failed');
    } finally {
      setSending(false);
      setTimeout(() => setResult(null), 4000);
    }
  };

  const executeAction = async (action: string, args: Record<string, unknown> = {}) => {
    setSending(true);
    setExecutingAction(action);
    setResult(null);
    try {
      const res = await fetch(`${API}/api/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, args }),
      });
      const data = await res.json();
      if (data.success) {
        setResult(data.result || `${action} completed`);
        setHistory((prev) => [{
          to: 'via OpenClaw',
          subject: action.replace(/_/g, ' '),
          status: 'completed',
          time: new Date().toLocaleTimeString(),
        }, ...prev]);
      } else {
        setResult(`Failed: ${data.error}`);
      }
    } catch {
      setResult('Failed to connect to backend');
    } finally {
      setSending(false);
      setExecutingAction(null);
      setTimeout(() => setResult(null), 5000);
    }
  };

  const loadPreview = async () => {
    if (!body) return;
    try {
      const res = await fetch(`${API}/api/email/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const data = await res.json();
      setPreviewHtml(data.html || '');
      setShowPreview(true);
    } catch {
      setShowPreview(false);
    }
  };

  const templates = [
    {
      name: 'Follow-up Reminder',
      subject: 'Reminder: Pending Action Item',
      body: '## Pending Action Item\n\nHi,\n\nThis is a friendly reminder about a pending follow-up that requires your attention.\n\n- [ ] Review and update status\n- [ ] Respond by EOD\n\n---\n\n**Priority:** P1\n\nBest regards,\n**NeuralEDGE CoS**',
    },
    {
      name: 'Client Status Update',
      subject: 'Project Status Update — NeuralEDGE',
      body: '## Weekly Status Update\n\nHi,\n\nHere is your project status update:\n\n### Deliverables\n- [x] Phase 1 complete\n- [ ] Phase 2 in progress\n- [ ] Phase 3 pending\n\n### Metrics\n- **Health Score:** 85%\n- **On Track:** Yes\n\n---\n\nPlease let us know if you have any questions.\n\nBest regards,\n**NeuralEDGE Team**',
    },
    {
      name: 'Meeting Summary',
      subject: 'Meeting Notes & Action Items',
      body: '## Meeting Notes\n\n**Date:** Today\n**Attendees:** Team\n\n### Decisions\n- Decision 1\n- Decision 2\n\n### Action Items\n- [ ] Action for person A\n- [ ] Action for person B\n\n### Next Steps\n- Follow up by Friday\n\n---\n\n*Sent from NeuralEDGE PULSE Command Center*',
    },
    {
      name: 'Sprint Update',
      subject: 'Sprint Progress Report',
      body: '## Sprint Update\n\n### Completed\n- [x] Task 1\n- [x] Task 2\n\n### In Progress\n- [ ] Task 3\n- [ ] Task 4\n\n### Blocked\n- **Blocker:** Description\n\n---\n\n**Velocity:** On track\n**Sprint Health:** Good',
    },
    {
      name: 'Morning Briefing',
      subject: 'Morning Briefing — NeuralEDGE CoS',
      body: '# Good Morning\n\nHere\'s your daily briefing:\n\n### Today\'s Priorities\n- [ ] Priority 1\n- [ ] Priority 2\n- [ ] Priority 3\n\n### Meetings\n- **11:00** Morning Standup\n- **19:00** Evening Sync\n\n### Overdue Items\n- Item 1 (assigned to: person)\n\n---\n\n**Team Health:** On track',
    },
    {
      name: 'Overdue Alert',
      subject: 'ALERT: Overdue Follow-ups',
      body: '## Overdue Follow-ups\n\nThe following items are past their due date:\n\n- [ ] FU-0002: Review Von Albert invoice status — **mansi** (due: 2026-03-19)\n- [ ] FU-0007: Fix Breakfree dashboard downtime — **naveen** (due: 2026-03-20)\n\n---\n\n**Action Required:** Please update status or escalate.\n\n*This is an automated notification from NeuralEDGE CoS.*',
    },
  ];

  const applyTemplate = (t: typeof templates[0]) => {
    setSubject(t.subject);
    setBody(t.body);
    setShowTemplates(false);
  };

  const emailContacts = contacts.filter((c) => c.email);

  const automations = [
    {
      name: 'Send Overdue Alerts',
      desc: 'Email all P0 overdue items to team leads',
      priority: 'P0',
      key: 'send_overdue_alerts',
      action: () => executeAction('send_overdue_alerts'),
    },
    {
      name: 'Daily Digest to CEO',
      desc: 'Send daily summary to yatharth@synlex.tech',
      key: 'daily_digest_ceo',
      action: () => executeAction('daily_digest_ceo'),
    },
    {
      name: 'Sprint Status to Team',
      desc: 'Email current sprint progress to all members with email',
      key: 'sprint_status_team',
      action: () => executeAction('sprint_status_team'),
    },
    {
      name: 'P1 Follow-up Reminders',
      desc: 'Notify P1-routed team members about pending follow-ups',
      priority: 'P1',
      key: 'p1_followup_reminders',
      action: () => executeAction('p1_followup_reminders'),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold" style={{ color: '#e5e7eb' }}>Email Sender</h2>
          <p className="text-[12px] mt-0.5" style={{ color: '#6b7280' }}>
            Markdown → branded NeuralEDGE HTML · AWS SES · {config?.from || '...'}
          </p>
        </div>
        {config && (
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${config.configured ? 'bg-emerald-400' : 'bg-red-400'}`} />
            <span className="text-[11px]" style={{ color: config.configured ? '#4ade80' : '#f87171' }}>
              {config.configured ? 'SES Connected' : 'Not Configured'}
            </span>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)' }}>
        {(['compose', 'automate'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className="px-4 py-1.5 rounded-md text-[12px] font-medium transition-all capitalize"
            style={tab === t
              ? { background: 'rgba(99,102,241,0.15)', color: '#818cf8' }
              : { color: '#6b7280' }
            }>
            {t === 'compose' ? 'Compose & Send' : 'Automations'}
          </button>
        ))}
      </div>

      {tab === 'compose' ? (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Compose */}
          <div className="xl:col-span-2 space-y-4">
            <div className="card p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold" style={{ color: '#e5e7eb' }}>Compose</h3>
                <div className="flex gap-1.5">
                  <button onClick={() => setShowTemplates(!showTemplates)} className="btn btn-secondary text-[11px] py-1.5">
                    Templates
                  </button>
                  {body && (
                    <button onClick={loadPreview} className="btn btn-secondary text-[11px] py-1.5">
                      Preview
                    </button>
                  )}
                </div>
              </div>

              {showTemplates && (
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                  {templates.map((t) => (
                    <button key={t.name} onClick={() => applyTemplate(t)}
                      className="text-left p-3 rounded-lg transition-all hover:border-indigo-500/30"
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <p className="text-[12px] font-medium" style={{ color: '#d1d5db' }}>{t.name}</p>
                      <p className="text-[10px] mt-0.5 truncate" style={{ color: '#6b7280' }}>{t.subject}</p>
                    </button>
                  ))}
                </div>
              )}

              <div>
                <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>To</label>
                <input placeholder="email@example.com" value={to} onChange={(e) => setTo(e.target.value)} className="w-full mt-1" />
              </div>
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>Subject</label>
                <input placeholder="Email subject" value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full mt-1" />
              </div>
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>
                  Body <span style={{ color: '#4b5563' }}>— markdown: **bold** *italic* `code` ## headers - lists - [ ] checklists ---</span>
                </label>
                <textarea
                  placeholder="Write your message in markdown..."
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="w-full mt-1 font-mono text-[13px]"
                  rows={14}
                  style={{ lineHeight: '1.6' }}
                />
              </div>

              <div className="flex items-center justify-between pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                <div className="flex gap-2">
                  <button onClick={send} disabled={sending || !to || !subject || !body}
                    className="btn btn-primary text-[12px] disabled:opacity-40">
                    {sending ? 'Sending...' : 'Send'}
                  </button>
                  {emailContacts.length > 0 && subject && body && (
                    <button onClick={sendToAll} disabled={sending}
                      className="btn btn-secondary text-[12px] disabled:opacity-40">
                      Send to All Team ({emailContacts.length})
                    </button>
                  )}
                </div>
                <p className="text-[10px]" style={{ color: '#4b5563' }}>
                  Renders as branded NeuralEDGE HTML + plain text fallback
                </p>
              </div>
            </div>

            {/* Preview */}
            {showPreview && previewHtml && (
              <div className="card p-0 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <span className="text-[11px] font-medium" style={{ color: '#9ca3af' }}>Email Preview</span>
                  <button onClick={() => setShowPreview(false)} className="text-[11px]" style={{ color: '#6b7280' }}>Close</button>
                </div>
                <div className="p-1 rounded-b-xl" style={{ background: '#f5f5f7' }}>
                  <iframe
                    srcDoc={previewHtml}
                    className="w-full rounded-b-xl"
                    style={{ height: '500px', border: 'none' }}
                    title="Email Preview"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            <div className="card p-5">
              <h3 className="text-sm font-semibold mb-3" style={{ color: '#e5e7eb' }}>Team Contacts</h3>
              <p className="text-[10px] mb-2" style={{ color: '#4b5563' }}>From notification-routes.json — click to set as recipient</p>
              <div className="space-y-1.5">
                {emailContacts.map((c) => (
                  <button key={c.slug} onClick={() => setTo(c.email!)}
                    className="w-full text-left px-3 py-2 rounded-lg text-[12px] transition-all flex items-center justify-between"
                    style={{ background: to === c.email ? 'rgba(99,102,241,0.1)' : 'rgba(255,255,255,0.03)', border: `1px solid ${to === c.email ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.06)'}` }}>
                    <span style={{ color: '#d1d5db' }}>{c.slug}</span>
                    <span style={{ color: '#6b7280' }}>{c.email}</span>
                  </button>
                ))}
                {emailContacts.length === 0 && (
                  <p className="text-[12px]" style={{ color: '#4b5563' }}>No contacts with email addresses</p>
                )}
              </div>
            </div>

            <div className="card p-5">
              <h3 className="text-sm font-semibold mb-3" style={{ color: '#e5e7eb' }}>Sent This Session</h3>
              {history.length === 0 ? (
                <p className="text-[12px]" style={{ color: '#4b5563' }}>No emails sent yet</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-auto">
                  {history.slice(0, 15).map((h, i) => (
                    <div key={i} className="text-[12px] p-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)' }}>
                      <div className="flex items-center justify-between">
                        <span className="truncate" style={{ color: '#d1d5db' }}>{h.subject}</span>
                        <span className="badge badge-green text-[9px] shrink-0 ml-1">{h.status}</span>
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span style={{ color: '#6b7280' }}>{h.to}</span>
                        <span style={{ color: '#4b5563' }}>{h.time}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Automations tab */
        <div className="space-y-6">
          {/* Gateway status */}
          {gatewayStatus && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <span className={`w-2 h-2 rounded-full ${gatewayStatus.connected ? 'bg-emerald-400' : 'bg-red-400'}`} />
              <span className="text-[12px] font-medium" style={{ color: '#d1d5db' }}>OpenClaw Gateway</span>
              <span className="text-[11px]" style={{ color: gatewayStatus.connected ? '#4ade80' : '#f87171' }}>
                {gatewayStatus.connected ? 'Connected' : 'Disconnected'}
              </span>
              {gatewayStatus.connected && (
                <span className="text-[10px] ml-auto" style={{ color: '#4b5563' }}>Actions execute via OpenClaw agent</span>
              )}
              {!gatewayStatus.connected && gatewayStatus.error && (
                <span className="text-[10px] ml-auto" style={{ color: '#6b7280' }}>{gatewayStatus.error}</span>
              )}
            </div>
          )}

          {/* Auto-schedule */}
          {schedule.length > 0 && (
            <div className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold" style={{ color: '#e5e7eb' }}>Auto-Schedule (Running)</h3>
                <span className="badge badge-green text-[10px]">Active</span>
              </div>
              <p className="text-[10px] mb-3" style={{ color: '#4b5563' }}>
                These emails are sent automatically every day. Times in IST (Asia/Kolkata).
              </p>
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

          {/* Gmail Status */}
          {gmailConfig && (
            <div className="card p-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold" style={{ color: '#e5e7eb' }}>Gmail Integration</h3>
                <span className={`badge text-[10px] ${gmailConfig.configured ? 'badge-green' : 'badge-yellow'}`}>
                  {gmailConfig.configured ? 'Connected' : 'Needs Setup'}
                </span>
              </div>
              {!gmailConfig.configured && gmailConfig.note && (
                <p className="text-[11px] p-2 rounded-lg" style={{ background: 'rgba(234,179,8,0.08)', color: '#facc15' }}>{gmailConfig.note}</p>
              )}
              {gmailConfig.configured && (
                <p className="text-[11px]" style={{ color: '#6b7280' }}>Gmail inbox read, search, and draft available via API.</p>
              )}
            </div>
          )}

          {/* Quick actions */}
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider mb-3" style={{ color: '#6b7280' }}>Manual Triggers</p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {automations.map((a) => (
                <div key={a.name} className="card p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="text-[13px] font-semibold" style={{ color: '#e5e7eb' }}>{a.name}</h4>
                      <p className="text-[11px] mt-1" style={{ color: '#6b7280' }}>{a.desc}</p>
                      {'priority' in a && a.priority && (
                        <span className={`badge mt-2 text-[10px] ${a.priority === 'P0' ? 'badge-red' : 'badge-yellow'}`}>{a.priority} routing</span>
                      )}
                    </div>
                    <button onClick={a.action} disabled={sending}
                      className="btn btn-primary text-[11px] py-1.5 shrink-0 disabled:opacity-40">
                      {executingAction === a.key ? 'Executing...' : 'Run'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* History */}
          {history.length > 0 && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold mb-3" style={{ color: '#e5e7eb' }}>Recent Activity</h3>
              <div className="space-y-2 max-h-48 overflow-auto">
                {history.slice(0, 10).map((h, i) => (
                  <div key={i} className="flex items-center justify-between text-[12px] px-2 py-1.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <span style={{ color: '#d1d5db' }}>{h.subject}</span>
                    <div className="flex items-center gap-2">
                      <span style={{ color: '#6b7280' }}>{h.to}</span>
                      <span className="badge badge-green text-[9px]">{h.status}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {result && (
        <div className={`toast ${result.includes('Failed') ? '!bg-red-600' : ''}`}>
          {result}
          <button onClick={() => setResult(null)} className="ml-3 opacity-60 hover:opacity-100">x</button>
        </div>
      )}
    </div>
  );
}
