import HealthBadge from './HealthBadge';

interface ClientCardProps {
  name: string;
  slug: string;
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

function scoreToHealth(score: number): string {
  if (score >= 80) return 'green';
  if (score >= 60) return 'yellow';
  if (score >= 40) return 'orange';
  return 'red';
}

export default function ClientCard({
  name, industry, phase, contract_value, health_score,
  last_interaction, last_interaction_type, sentiment,
  overdue_invoices, deliverables_on_track,
}: ClientCardProps) {
  const health = scoreToHealth(health_score || 0);

  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="font-semibold text-sm" style={{ color: '#e5e7eb' }}>{name}</h3>
            <p className="text-[11px] mt-0.5" style={{ color: '#6b7280' }}>{industry}</p>
          </div>
          <HealthBadge health={health} />
        </div>
        <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-[12px]">
          <div>
            <p className="text-[10px] uppercase tracking-wider font-medium" style={{ color: '#4b5563' }}>Phase</p>
            <p className="font-medium capitalize mt-0.5" style={{ color: '#9ca3af' }}>{phase}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider font-medium" style={{ color: '#4b5563' }}>Value</p>
            <p className="font-medium mt-0.5" style={{ color: '#9ca3af' }}>{contract_value}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider font-medium" style={{ color: '#4b5563' }}>Health</p>
            <p className="font-bold mt-0.5" style={{ color: '#e5e7eb' }}>{health_score}%</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider font-medium" style={{ color: '#4b5563' }}>Sentiment</p>
            <p className={`font-medium capitalize mt-0.5`} style={{
              color: sentiment === 'positive' ? '#4ade80' : sentiment === 'negative' ? '#f87171' : '#9ca3af'
            }}>{sentiment}</p>
          </div>
        </div>
      </div>
      <div className="px-5 py-3 flex items-center justify-between" style={{ background: 'rgba(255,255,255,0.02)', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
        <span className="text-[11px]" style={{ color: '#4b5563' }}>Last: {last_interaction_type} · {last_interaction}</span>
        <div className="flex gap-2">
          {overdue_invoices > 0 && <span className="badge badge-red">{overdue_invoices} overdue</span>}
          {!deliverables_on_track && <span className="badge badge-orange">Off track</span>}
        </div>
      </div>
    </div>
  );
}
