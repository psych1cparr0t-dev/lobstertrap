import React, { useEffect, useState } from 'react';
import { Agent } from './types';
import AgentCard from './components/AgentCard';
import MetricsPanel from './components/MetricsPanel';
import LogViewer from './components/LogViewer';
import ChatBar from './components/ChatBar';

type Tab = 'metrics' | 'logs' | 'chat';

export default function App() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('metrics');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/agents');
        if (!res.ok) throw new Error();
        const data: Agent[] = await res.json();
        setAgents(data);
        if (data.length > 0 && !selected) setSelected(data[0].name);
      } catch {
        setAgents([]);
      } finally {
        setLoading(false);
      }
    };

    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  const selectedAgent = agents.find((a) => a.name === selected);
  const runningCount = agents.filter((a) => a.dockerStatus === 'running').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0a0a0a' }}>

      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 1.5rem', height: 52,
        background: '#0d0d0d', borderBottom: '1px solid #1a1a1a',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ fontWeight: 700, fontSize: '0.95rem', letterSpacing: '-0.02em', color: '#e0e0e0' }}>LobsterTrap</span>
          <span style={{ color: '#333', fontSize: '0.75rem' }}>Dashboard</span>
        </div>
        <div style={{ fontSize: '0.78rem', color: '#444' }}>
          {runningCount} running · {agents.length} total
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        <aside style={{
          width: 220, flexShrink: 0,
          borderRight: '1px solid #1a1a1a',
          padding: '1rem 0.75rem',
          overflowY: 'auto',
          background: '#0d0d0d',
        }}>
          <div style={{ fontSize: '0.68rem', color: '#333', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem', paddingLeft: '0.25rem' }}>
            Agents
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {loading ? (
              <div style={{ color: '#333', fontSize: '0.82rem', padding: '0.5rem 0.25rem' }}>Loading...</div>
            ) : agents.length === 0 ? (
              <div style={{ color: '#2e2e2e', fontSize: '0.82rem', padding: '0.5rem 0.25rem', lineHeight: 1.5 }}>
                No agents connected.<br />
                <span style={{ color: '#252525' }}>Run <code style={{ fontFamily: 'monospace', color: '#333' }}>lobstertrap deploy</code> to start one.</span>
              </div>
            ) : agents.map((agent) => (
              <AgentCard
                key={agent.name}
                agent={agent}
                selected={selected === agent.name}
                onClick={() => setSelected(agent.name)}
              />
            ))}
          </div>
        </aside>

        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {selectedAgent ? (
            <>
              <div style={{
                padding: '0.9rem 1.5rem',
                borderBottom: '1px solid #1a1a1a',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                flexShrink: 0,
              }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: '#e0e0e0' }}>{selectedAgent.name}</h2>
                  <div style={{ color: '#444', fontSize: '0.78rem', marginTop: 2 }}>
                    {selectedAgent.template} · :{selectedAgent.port}
                    {selectedAgent.integrations?.length > 0 && ` · ${selectedAgent.integrations.join(', ')}`}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.125rem', background: '#111', borderRadius: 6, padding: 2 }}>
                  {(['metrics', 'logs', 'chat'] as Tab[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTab(t)}
                      style={{
                        background: tab === t ? '#1c1c1c' : 'none',
                        border: tab === t ? '1px solid #2a2a2a' : '1px solid transparent',
                        color: tab === t ? '#c0c0c0' : '#444',
                        borderRadius: 4,
                        padding: '3px 12px',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        fontWeight: tab === t ? 500 : 400,
                        textTransform: 'capitalize',
                        letterSpacing: '0.01em',
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {tab === 'metrics' && (
                  <div style={{ flex: 1, padding: '1.25rem 1.5rem', overflowY: 'auto' }}>
                    <MetricsPanel agentName={selectedAgent.name} />
                  </div>
                )}
                {tab === 'logs' && (
                  <div style={{ flex: 1, padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <LogViewer agentName={selectedAgent.name} />
                  </div>
                )}
                {tab === 'chat' && <ChatBar agent={selectedAgent} />}
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#252525', flexDirection: 'column', gap: '0.4rem' }}>
              <span style={{ fontSize: '0.85rem' }}>Select an agent</span>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
