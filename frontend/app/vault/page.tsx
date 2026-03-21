'use client';

import { useEffect, useState } from 'react';
import useWebSocket from '@/components/useWebSocket';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface VaultEntry {
  id: number | string;
  namespace: string;
  content: string;
  tags: string[];
  created_at: string;
  metadata?: Record<string, unknown>;
}

export default function VaultPage() {
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const { lastMessage } = useWebSocket();

  const load = () => {
    fetch(`${API}/api/vault`)
      .then((r) => r.json())
      .then((d) => {
        setEntries(Array.isArray(d) ? d : d.entries || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (lastMessage?.type === 'vault_update') {
      load();
    }
  }, [lastMessage]);

  const filtered = entries.filter((e) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.content.toLowerCase().includes(q) ||
      e.namespace.toLowerCase().includes(q) ||
      e.tags?.some((t) => t.toLowerCase().includes(q))
    );
  });

  // Group by namespace
  const grouped = filtered.reduce<Record<string, VaultEntry[]>>((acc, entry) => {
    const ns = entry.namespace || 'general';
    if (!acc[ns]) acc[ns] = [];
    acc[ns].push(entry);
    return acc;
  }, {});

  const namespaces = Object.keys(grouped).sort();

  const nsColor = (ns: string) => {
    const colors: Record<string, string> = {
      decisions: 'badge-purple',
      clients: 'badge-blue',
      processes: 'badge-green',
      team: 'badge-yellow',
      general: 'badge-gray',
    };
    return colors[ns] || 'badge-gray';
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return iso;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-sm text-gray-500">Loading vault...</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-100">Knowledge Vault</h2>
          <p className="text-[12px] text-gray-500 mt-0.5">{entries.length} entries across {namespaces.length} namespaces</p>
        </div>
      </div>

      {/* Search */}
      <div>
        <input
          type="text"
          placeholder="Search entries by content, namespace, or tag..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-md"
        />
      </div>

      {/* Grouped entries */}
      {namespaces.length === 0 && (
        <div className="card p-12 text-center">
          <p className="text-sm text-gray-500">{search ? 'No entries match your search.' : 'No vault entries yet.'}</p>
        </div>
      )}

      {namespaces.map((ns) => (
        <div key={ns}>
          <div className="flex items-center gap-2 mb-3">
            <span className={`badge ${nsColor(ns)}`}>{ns}</span>
            <span className="text-[11px] text-gray-600 font-medium">{grouped[ns].length}</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
            {grouped[ns].map((entry) => (
              <div key={entry.id} className="card p-4">
                <p className="text-[13px] text-gray-200 leading-relaxed mb-3">{entry.content}</p>
                <div className="flex items-center justify-between">
                  <div className="flex gap-1 flex-wrap">
                    {entry.tags?.map((tag) => (
                      <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.04] text-gray-500 font-medium">{tag}</span>
                    ))}
                  </div>
                  <span className="text-[10px] text-gray-600 shrink-0 ml-2">{formatDate(entry.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
