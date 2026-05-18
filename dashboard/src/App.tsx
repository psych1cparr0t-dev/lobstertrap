import React, { useEffect, useState } from 'react';
import { Agent } from './types';
import AgentCard from './components/AgentCard';
import MetricsPanel from './components/MetricsPanel';
import LogViewer from './components/LogViewer';
import ChatBar from './components/ChatBar';

type Tab = 'metrics' | 'logs' | 'chat';

const MOCK_AGENTS: Agent[] = [
  { name: 'SalesBot', template: 'Sales Agent', port: '8000', status: 'running', dockerStatus: 'running', integrations: ['Gmail', 'Airtable'], createdAt: new Date().toISOString(), lastDeployedAt: new Date().toISOString(), dir: '' },
  { name: 'SupportBot', template: 'Support Agent', port: '8001', status: 'created', dockerStatus: 'exited', integrations: ['Slack'], createdAt: new Date().toISOString(), dir: '' },
];

export default function App() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('metrics');
  const [loading, setLoading] = useState(true);
  const [usingMock, setUsingMock] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/agents');
        if (!res.ok) throw new Error();
        const data: Agent[] = await res.json();
        setAgents(data.length ? data : MOCK_AGENTS);
        setUsingMock(data.length === 0);
        if (data.length > 0 && !selected) setSelected(data[0].name);
        else if (data.length === 0) setSelected(MOCK_AGENTS[0].name);
      } catch {
        setAgents(MOCK_AGENTS);
        setUsingMock(true);
        setSelected(MOCK_AGENTS[0].name);
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

      {/* Header */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 1.5rem', height: 52,
        background: '#101010', borderBottom: '1px solid #1e1e1e',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span style={{ fontSize: '1.2rem' }}>🦞</span>
          <span style={{ fontWeight: 700, fontSize: '1rem', letterSpacing: '-0.02em' }}>LobsterTrap</span>
          <span style={{ color: '#444', fontSize: '0.75rem', marginLeft: 4 }}>Dashboard</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: '#555' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: runningCount > 0 ? '#4ade80' : '#444', display: 'inline-block' }} />
          {runningCount} running · {agents.length} total
          {usingMock && <span style={{ marginLeft: 8, color: '#6b7280', fontStyle: 'italic' }}>(demo data)</span>}
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Sidebar */}
        <aside style={{
          width: 240, flexShrink: 0,
          borderRight: '1px solid #1a1a1a',
          padding: '1rem 0.75rem',
          overflowY: 'auto',
          background: '#0d0d0d',
        }}>
          <div style={{ fontSize: '0.7rem', color: '#444', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.75rem', paddingLeft: '0.25rem' }}>
            Agents
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {loading ? (
              <div style={{ color: '#444', fontSize: '0.85rem', padding: '0.5rem' }}>Loading...</div>
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

        {/* Main content */}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {selectedAgent ? (
            <>
              {/* Agent header */}
              <div style={{
                padding: '1rem 1.5rem',
                borderBottom: '1px solid #1a1a1a',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                flexShrink: 0,
              }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>{selectedAgent.name}</h2>
                  <div style={{ color: '#555', fontSize: '0.8rem', marginTop: 2 }}>
                    {selectedAgent.template} · port {selectedAgent.port}
                    {selectedAgent.integrations?.length > 0 && ` · ${selectedAgent.integrations.join(', ')}`}
                  </div>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', gap: '0.25rem', background: '#141414', borderRadius: 8, padding: 3 }}>
                  {(['metrics', 'logs', 'chat'] as Tab[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTab(t)}
                      style={{
                        background: tab === t ? '#1e1e2e' : 'none',
                        border: tab === t ? '1px solid #333' : '1px solid transparent',
                        color: tab === t ? '#e0e0e0' : '#555',
                        borderRadius: 6,
                        padding: '4px 14px',
                        cursor: 'pointer',
                        fontSize: '0.82rem',
                        fontWeight: tab === t ? 600 : 400,
                        textTransform: 'capitalize',
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tab content */}
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: '#333', flexDirection: 'column', gap: '0.5rem' }}>
              <span style={{ fontSize: '2rem' }}>🦞</span>
              <span>Select an agent to inspect</span>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
