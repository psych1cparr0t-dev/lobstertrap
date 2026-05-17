import React, { useEffect, useState } from 'react';
import { AgentMetrics } from '../types';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface Props {
  agentName: string;
}

interface DataPoint {
  time: string;
  cpu: number;
  memMB: number;
}

function parseCpu(cpu: string): number {
  return parseFloat(cpu?.replace('%', '') || '0');
}

function parseMemMB(mem: string): number {
  if (!mem) return 0;
  const n = parseFloat(mem);
  if (mem.includes('GiB')) return n * 1024;
  if (mem.includes('MiB')) return n;
  if (mem.includes('KiB')) return n / 1024;
  return n;
}

export default function MetricsPanel({ agentName }: Props) {
  const [metrics, setMetrics] = useState<AgentMetrics | null>(null);
  const [history, setHistory] = useState<DataPoint[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const fetch_ = async () => {
      try {
        const res = await fetch(`/api/agents/${agentName}/metrics`);
        if (!res.ok) throw new Error('not found');
        const data: AgentMetrics = await res.json();
        if (cancelled) return;
        setMetrics(data);
        setError('');

        if (data.docker) {
          const point: DataPoint = {
            time: new Date().toLocaleTimeString(),
            cpu: parseCpu(data.docker.cpu),
            memMB: parseMemMB(data.docker.memory),
          };
          setHistory((h) => [...h.slice(-29), point]);
        }
      } catch {
        if (!cancelled) setError('Container not running or metrics unavailable.');
      }
    };

    fetch_();
    const id = setInterval(fetch_, 2500);
    return () => { cancelled = true; clearInterval(id); };
  }, [agentName]);

  if (error) {
    return (
      <div style={{ padding: '1.5rem', color: '#6b7280', fontSize: '0.9rem' }}>
        {error}
      </div>
    );
  }

  if (!metrics?.docker) {
    return <div style={{ padding: '1.5rem', color: '#555', fontSize: '0.9rem' }}>Loading metrics...</div>;
  }

  const m = metrics.docker;

  return (
    <div>
      {/* Stat pills */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {[
          { label: 'CPU', value: m.cpu },
          { label: 'Memory', value: `${m.memory} / ${m.memoryLimit}` },
          { label: 'Net In', value: m.networkIn },
          { label: 'Net Out', value: m.networkOut },
        ].map(({ label, value }) => (
          <div key={label} style={{ background: '#0f0f0f', border: '1px solid #222', borderRadius: 8, padding: '0.85rem' }}>
            <div style={{ fontSize: '0.7rem', color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.3rem' }}>{label}</div>
            <div style={{ fontWeight: 600, fontSize: '0.95rem', color: '#e0e0e0', fontVariantNumeric: 'tabular-nums' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* CPU chart */}
      {history.length > 1 && (
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '0.75rem', color: '#555', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>CPU % (live)</div>
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={history}>
              <defs>
                <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#444' }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: '#444' }} domain={[0, 100]} width={30} />
              <Tooltip
                contentStyle={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: '#888' }}
              />
              <Area type="monotone" dataKey="cpu" stroke="#7c3aed" fill="url(#cpuGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Memory chart */}
      {history.length > 1 && (
        <div>
          <div style={{ fontSize: '0.75rem', color: '#555', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Memory MB (live)</div>
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={history}>
              <defs>
                <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#444' }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: '#444' }} width={35} />
              <Tooltip
                contentStyle={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: '#888' }}
              />
              <Area type="monotone" dataKey="memMB" stroke="#06b6d4" fill="url(#memGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
