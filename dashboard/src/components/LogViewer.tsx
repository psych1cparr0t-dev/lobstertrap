import React, { useEffect, useRef, useState } from 'react';

interface Props {
  agentName: string;
}

interface LogLine {
  line: string;
  ts: string;
}

export default function LogViewer({ agentName }: Props) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    setLines([]);
    setError('');

    const es = new EventSource(`/api/logs/${agentName}/stream?tail=100`);
    esRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      try {
        const data: LogLine = JSON.parse(e.data);
        setLines((prev) => [...prev.slice(-499), data]);
      } catch {}
    };

    es.onerror = () => {
      setConnected(false);
      setError('Log stream disconnected. Container may not be running.');
      es.close();
    };

    return () => {
      es.close();
      setConnected(false);
    };
  }, [agentName]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  const colorize = (line: string): React.ReactNode => {
    if (line.includes('ERROR') || line.includes('error') || line.includes('Error')) {
      return <span style={{ color: '#f87171' }}>{line}</span>;
    }
    if (line.includes('WARN') || line.includes('warn') || line.includes('Warning')) {
      return <span style={{ color: '#facc15' }}>{line}</span>;
    }
    if (line.includes('INFO') || line.includes('info') || line.includes('GET') || line.includes('POST')) {
      return <span style={{ color: '#86efac' }}>{line}</span>;
    }
    return <span style={{ color: '#a0a0a0' }}>{line}</span>;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <span style={{
          width: 7, height: 7, borderRadius: '50%',
          background: connected ? '#4ade80' : '#6b7280',
          display: 'inline-block',
        }} />
        <span style={{ fontSize: '0.75rem', color: '#555' }}>
          {connected ? 'Live' : 'Disconnected'} — {lines.length} lines
        </span>
        <button
          onClick={() => setLines([])}
          style={{ marginLeft: 'auto', background: 'none', border: '1px solid #333', color: '#555', borderRadius: 4, padding: '1px 8px', cursor: 'pointer', fontSize: '0.72rem' }}
        >
          Clear
        </button>
      </div>

      {error && <div style={{ color: '#f87171', fontSize: '0.8rem', marginBottom: '0.5rem' }}>{error}</div>}

      <div style={{
        flex: 1,
        background: '#080808',
        border: '1px solid #1e1e1e',
        borderRadius: 8,
        padding: '0.75rem',
        overflowY: 'auto',
        fontFamily: 'Monaco, Menlo, "Courier New", monospace',
        fontSize: '0.75rem',
        lineHeight: 1.6,
      }}>
        {lines.length === 0 && (
          <span style={{ color: '#333' }}>Waiting for log output...</span>
        )}
        {lines.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: '0.75rem' }}>
            <span style={{ color: '#333', whiteSpace: 'nowrap', flexShrink: 0 }}>
              {new Date(l.ts).toLocaleTimeString()}
            </span>
            {colorize(l.line)}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
