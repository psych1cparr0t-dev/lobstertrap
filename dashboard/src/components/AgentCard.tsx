import React from 'react';
import { Agent } from '../types';

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  running:    { bg: '#0d2a1a', text: '#4ade80', dot: '#4ade80' },
  exited:     { bg: '#2a0d0d', text: '#f87171', dot: '#f87171' },
  created:    { bg: '#1a1a0d', text: '#facc15', dot: '#facc15' },
  'not found':{ bg: '#1a1a1a', text: '#6b7280', dot: '#6b7280' },
  unknown:    { bg: '#1a1a1a', text: '#6b7280', dot: '#6b7280' },
};

const TEMPLATE_ICONS: Record<string, string> = {
  'Sales Agent':   '💰',
  'CRM Agent':     '🤝',
  'Support Agent': '🎧',
  'Custom Agent':  '⚙️',
};

interface Props {
  agent: Agent;
  selected: boolean;
  onClick: () => void;
}

export default function AgentCard({ agent, selected, onClick }: Props) {
  const status = agent.dockerStatus || 'unknown';
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.unknown;
  const icon = TEMPLATE_ICONS[agent.template] ?? '🤖';

  return (
    <div
      onClick={onClick}
      style={{
        background: selected ? '#1e1e2e' : '#141414',
        border: `1px solid ${selected ? '#7c3aed' : '#252525'}`,
        borderRadius: 12,
        padding: '1.25rem',
        cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
        <div>
          <span style={{ fontSize: '1.25rem', marginRight: '0.5rem' }}>{icon}</span>
          <span style={{ fontWeight: 700, fontSize: '1rem' }}>{agent.name}</span>
        </div>
        <span style={{
          background: colors.bg,
          color: colors.text,
          borderRadius: 999,
          padding: '2px 10px',
          fontSize: '0.75rem',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: colors.dot, display: 'inline-block' }} />
          {status}
        </span>
      </div>

      <div style={{ color: '#888', fontSize: '0.8rem', marginBottom: '0.5rem' }}>{agent.template}</div>

      <div style={{ display: 'flex', gap: '1rem', fontSize: '0.78rem', color: '#555' }}>
        <span>:{agent.port}</span>
        {(agent.integrations ?? []).length > 0 && (
          <span>{agent.integrations.join(', ')}</span>
        )}
      </div>

      {agent.lastDeployedAt && (
        <div style={{ marginTop: '0.6rem', fontSize: '0.72rem', color: '#444' }}>
          Deployed {new Date(agent.lastDeployedAt).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}
