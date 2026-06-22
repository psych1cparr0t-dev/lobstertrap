import React from 'react';
import { Agent } from '../types';

const STATUS_LABEL: Record<string, { color: string }> = {
  running:     { color: '#888' },
  exited:      { color: '#3a3a3a' },
  created:     { color: '#555' },
  'not found': { color: '#2e2e2e' },
  unknown:     { color: '#2e2e2e' },
};

interface Props {
  agent: Agent;
  selected: boolean;
  onClick: () => void;
}

export default function AgentCard({ agent, selected, onClick }: Props) {
  const status = agent.dockerStatus || 'unknown';
  const { color } = STATUS_LABEL[status] ?? STATUS_LABEL.unknown;

  return (
    <div
      onClick={onClick}
      style={{
        background: selected ? '#141414' : 'transparent',
        border: `1px solid ${selected ? '#262626' : 'transparent'}`,
        borderRadius: 6,
        padding: '0.7rem 0.75rem',
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
        <span style={{ fontWeight: 600, fontSize: '0.88rem', color: selected ? '#e0e0e0' : '#888' }}>{agent.name}</span>
        <span style={{ fontSize: '0.72rem', color, letterSpacing: '0.02em' }}>{status}</span>
      </div>

      <div style={{ color: '#333', fontSize: '0.75rem' }}>{agent.template}</div>

      {(agent.integrations ?? []).length > 0 && (
        <div style={{ marginTop: '0.3rem', fontSize: '0.72rem', color: '#2e2e2e' }}>
          {agent.integrations.join(' · ')}
        </div>
      )}
    </div>
  );
}
