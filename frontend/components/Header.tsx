'use client';

import { useEffect, useState } from 'react';
import useWebSocket from '@/components/useWebSocket';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function Header() {
  const { isConnected } = useWebSocket();
  const [gatewayConnected, setGatewayConnected] = useState<boolean | null>(null);

  useEffect(() => {
    fetch(`${API}/api/gateway/status`)
      .then((r) => r.json())
      .then((d) => setGatewayConnected(d.connected === true))
      .catch(() => setGatewayConnected(null));
  }, []);

  return (
    <header
      className="h-14 flex items-center justify-between px-6 border-b border-white/10"
      style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f172a 100%)' }}
    >
      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded-lg bg-indigo-500 flex items-center justify-center">
          <span className="text-white text-xs font-bold">NE</span>
        </div>
        <div className="flex items-baseline gap-2">
          <h1 className="text-white text-sm font-semibold tracking-wide">NEURALEDGE</h1>
          <span className="text-[11px] text-white/40 font-medium">Chief of Staff</span>
        </div>
      </div>
      <div className="flex items-center gap-4">
        {/* Live connection indicator */}
        <div className="flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400' : 'bg-red-400'}`}
            style={{ boxShadow: isConnected ? '0 0 6px rgba(52, 211, 153, 0.5)' : 'none' }}
          />
          <span className={`text-[10px] font-medium ${isConnected ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
            {isConnected ? 'Live' : 'Offline'}
          </span>
        </div>
        {/* OpenClaw gateway indicator */}
        {gatewayConnected !== null && (
          <>
            <div className="h-4 border-l border-white/10" />
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${gatewayConnected ? 'bg-emerald-400' : 'bg-red-400'}`}
                style={{ boxShadow: gatewayConnected ? '0 0 6px rgba(52, 211, 153, 0.5)' : 'none' }}
              />
              <span className={`text-[10px] font-medium ${gatewayConnected ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
                OpenClaw
              </span>
            </div>
          </>
        )}
        <span className="text-[11px] text-white/50 font-medium tracking-wide uppercase">Pulse Command Center</span>
        <div className="w-7 h-7 rounded-full bg-indigo-500/30 border border-indigo-400/30 flex items-center justify-center text-white text-[11px] font-semibold">
          MG
        </div>
      </div>
    </header>
  );
}
