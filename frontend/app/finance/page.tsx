'use client';

import { useEffect, useState } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface Snapshot {
  date: string;
  revenue: { collected_mtd: number; outstanding: number; overdue_invoices: number; overdue_amount: number; target_monthly: number; pipeline_weighted: number };
  expenses: { total_mtd: number; burn_rate_monthly: number; categories: Record<string, number> };
  bank_balance: number;
  runway_months: number;
  collection_pct: number;
  net_mtd: number;
  clients: Array<{ client: string; contract_value: string; collected_mtd: number; outstanding: number; status: string }>;
}

interface Invoice {
  id: string; client: string; amount: number; issued: string; due: string; status: string; paid_date: string | null;
}

interface Alert {
  level: string; message: string;
}

export default function FinancePage() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    fetch(`${API}/api/finance/snapshot`).then((r) => r.json()).then(setSnap).catch(() => {});
    fetch(`${API}/api/finance/invoices`).then((r) => r.json()).then((d) => setInvoices(d.invoices || [])).catch(() => {});
    fetch(`${API}/api/finance/alerts`).then((r) => r.json()).then((d) => setAlerts(d.alerts || [])).catch(() => {});
  }, []);

  const fmt = (n: number) => `₹${(n / 100000).toFixed(1)}L`;

  if (!snap) return <div className="text-sm" style={{ color: '#6b7280' }}>Loading financial data...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold" style={{ color: '#e5e7eb' }}>Financial Snapshot</h2>
          <p className="text-[12px] mt-0.5" style={{ color: '#6b7280' }}>Revenue, expenses, runway — {snap.date}</p>
        </div>
        <span className="badge badge-yellow text-[10px]">Placeholder Data</span>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="card p-4" style={{ background: 'rgba(239,68,68,0.06)', borderColor: 'rgba(239,68,68,0.15)' }}>
          <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: '#f87171' }}>Financial Alerts</p>
          {alerts.map((a, i) => (
            <p key={i} className="text-[12px] mb-1" style={{ color: a.level === 'critical' ? '#f87171' : '#facc15' }}>
              {a.level === 'critical' ? '🔴' : '🟡'} {a.message}
            </p>
          ))}
        </div>
      )}

      {/* Key Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Collected MTD', value: fmt(snap.revenue.collected_mtd), sub: `${snap.collection_pct}% of target`, border: 'stat-green' },
          { label: 'Outstanding', value: fmt(snap.revenue.outstanding), sub: `${snap.revenue.overdue_invoices} overdue`, border: 'stat-yellow' },
          { label: 'Burn Rate', value: fmt(snap.expenses.burn_rate_monthly), sub: '/month', border: 'stat-red' },
          { label: 'Runway', value: `${snap.runway_months}mo`, sub: fmt(snap.bank_balance) + ' balance', border: 'stat-blue' },
        ].map((m) => (
          <div key={m.label} className={`card p-5 ${m.border}`}>
            <p className="text-[10px] font-medium uppercase tracking-wider" style={{ color: '#6b7280' }}>{m.label}</p>
            <p className="text-2xl font-bold mt-1 tabular-nums" style={{ color: '#e5e7eb' }}>{m.value}</p>
            <p className="text-[11px] mt-0.5" style={{ color: '#4b5563' }}>{m.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Expense Breakdown */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold mb-4" style={{ color: '#e5e7eb' }}>Expense Breakdown (MTD)</h3>
          <div className="space-y-3">
            {Object.entries(snap.expenses.categories).map(([cat, amount]) => {
              const pct = Math.round((amount / snap.expenses.total_mtd) * 100);
              return (
                <div key={cat}>
                  <div className="flex justify-between text-[12px] mb-1">
                    <span className="capitalize" style={{ color: '#d1d5db' }}>{cat.replace('_', ' ')}</span>
                    <span style={{ color: '#9ca3af' }}>{fmt(amount)} ({pct}%)</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div className="h-1.5 rounded-full bg-indigo-500/60" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 pt-3 flex justify-between text-[12px]" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <span style={{ color: '#6b7280' }}>Total MTD</span>
            <span className="font-semibold" style={{ color: '#e5e7eb' }}>{fmt(snap.expenses.total_mtd)}</span>
          </div>
        </div>

        {/* Client Revenue */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold mb-4" style={{ color: '#e5e7eb' }}>Revenue by Client</h3>
          <div className="space-y-3">
            {snap.clients.map((c) => (
              <div key={c.client} className="flex items-center justify-between p-3 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
                <div>
                  <p className="text-[13px] font-medium" style={{ color: '#e5e7eb' }}>{c.client}</p>
                  <p className="text-[10px]" style={{ color: '#6b7280' }}>{c.contract_value}</p>
                </div>
                <div className="text-right">
                  <p className="text-[13px] font-semibold tabular-nums" style={{ color: '#e5e7eb' }}>{fmt(c.collected_mtd)}</p>
                  {c.outstanding > 0 && <p className="text-[10px]" style={{ color: '#facc15' }}>{fmt(c.outstanding)} outstanding</p>}
                  <span className={`badge text-[9px] mt-1 ${c.status === 'on_track' ? 'badge-green' : 'badge-red'}`}>{c.status.replace('_', ' ')}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Invoice Table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <h3 className="text-sm font-semibold" style={{ color: '#e5e7eb' }}>Invoices</h3>
        </div>
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              {['Invoice', 'Client', 'Amount', 'Issued', 'Due', 'Status'].map((h) => (
                <th key={h} className="text-left px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#6b7280' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td className="px-5 py-2.5 font-mono text-[11px]" style={{ color: '#9ca3af' }}>{inv.id}</td>
                <td className="px-5 py-2.5" style={{ color: '#d1d5db' }}>{inv.client}</td>
                <td className="px-5 py-2.5 tabular-nums" style={{ color: '#e5e7eb' }}>{fmt(inv.amount)}</td>
                <td className="px-5 py-2.5" style={{ color: '#6b7280' }}>{inv.issued}</td>
                <td className="px-5 py-2.5" style={{ color: '#6b7280' }}>{inv.due}</td>
                <td className="px-5 py-2.5">
                  <span className={`badge text-[10px] ${inv.status === 'paid' ? 'badge-green' : inv.status === 'overdue' ? 'badge-red' : 'badge-yellow'}`}>{inv.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-center" style={{ color: '#4b5563' }}>
        Placeholder data — connect Razorpay API + expense tracker for live financials
      </p>
    </div>
  );
}
