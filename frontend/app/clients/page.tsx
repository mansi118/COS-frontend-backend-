'use client';

import { useEffect, useState } from 'react';
import ClientCard from '@/components/ClientCard';
import useWebSocket from '@/components/useWebSocket';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface ClientData {
  id: number;
  slug: string;
  name: string;
  industry: string | null;
  phase: string | null;
  contract_value: string | null;
  health_score: number | null;
  last_interaction: string | null;
  last_interaction_type: string | null;
  sentiment: string | null;
  overdue_invoices: number;
  deliverables_on_track: boolean;
}

interface AtRisk {
  slug: string;
  name: string;
  health_score: number;
  sentiment: string;
}

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientData[]>([]);
  const [atRisk, setAtRisk] = useState<AtRisk[]>([]);
  const { lastMessage } = useWebSocket();

  const load = () => {
    fetch(`${API}/api/clients`).then((r) => r.json()).then(setClients);
    fetch(`${API}/api/clients/health`).then((r) => r.json()).then((d) => setAtRisk(d.at_risk));
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (lastMessage?.type === 'client_update') {
      load();
    }
  }, [lastMessage]);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-bold text-gray-100">Clients & Pipeline</h2>
        <p className="text-[12px] text-gray-500 mt-0.5">{clients.length} clients</p>
      </div>

      {/* At-risk Alerts */}
      {atRisk.length > 0 && (
        <div className="card p-4 border-orange-100 bg-orange-500/[0.08]">
          <p className="text-[11px] font-semibold text-orange-400 uppercase tracking-wider mb-1">At-Risk Clients (Health &lt; 60)</p>
          <div className="flex gap-4">
            {atRisk.map((c) => (
              <span key={c.slug} className="text-[12px] text-orange-400 font-medium">
                {c.name}: {c.health_score}% — {c.sentiment}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Client Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {clients.map((c) => (
          <ClientCard key={c.slug} {...c} />
        ))}
      </div>
    </div>
  );
}
