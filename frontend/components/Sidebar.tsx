'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/', label: 'PULSE Board', icon: '◉' },
  { href: '/followups', label: 'Follow-ups', icon: '☑' },
  { href: '/performance', label: 'Performance', icon: '△' },
  { href: '/clients', label: 'Clients', icon: '◆' },
  { href: '/sprint', label: 'Sprint', icon: '⟳' },
  { href: '/meetings', label: 'Meetings', icon: '◷' },
  { href: '/vault', label: 'Vault', icon: '▣' },
  { href: '/comms', label: 'Team Comms', icon: '📡' },
  { href: '/fireflies', label: 'Fireflies', icon: '🔥' },
  { href: '/finance', label: 'Finance', icon: '₹' },
  { href: '/intel', label: 'Intel', icon: '🌐' },
  { href: '/taskflow', label: 'TaskFlow', icon: '✓' },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-52 min-h-screen pt-3" style={{ background: '#0f0f1a', borderRight: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="px-3 mb-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider px-3 mb-1" style={{ color: '#4b5563' }}>Navigation</p>
      </div>
      <nav className="flex flex-col gap-0.5 px-3">
        {navItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] transition-all ${
                active
                  ? 'font-semibold'
                  : 'hover:bg-white/[0.04]'
              }`}
              style={active
                ? { background: 'rgba(99,102,241,0.12)', color: '#818cf8' }
                : { color: '#6b7280' }
              }
            >
              <span className="text-sm" style={{ color: active ? '#818cf8' : '#4b5563' }}>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
