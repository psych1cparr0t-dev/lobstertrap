import React, { useEffect, useRef, useState } from 'react';

interface Props {
  agentName: string;
}

interface LogLine {
  line: string;
  ts: string;
}

function dimLine(line: string): string {
  if (line.includes('ERROR') || line.includes('error') || line.includes('Error')) return '#888';
  if (line.includes('WARN') || line.includes('warn')) return '#555';
  return '#3a3a3a';
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
      setError('Stream disconnected. Container may not be running.');
      es.close();
    };

    return () => { es.close(); setConnected(false); };
  }, [agentName]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
        <span style={{ fontSize: '0.72rem', color: connected ? '#555' : '#2e2e2e', letterSpacing: '0.03em' }}>
          {connected ? 'live' : 'disconnected'} — {lines.length} lines
        </span>
        <button
          onClick={() => setLines([])}
          style={{ marginLeft: 'auto', background: 'none', border: '1px solid #222', color: '#444', borderRadius: 4, padding: '1px 8px', cursor: 'pointer', fontSize: '0.72rem' }}
        >
          clear
        </button>
      </div>

      {error && <div style={{ color: '#555', fontSize: '0.78rem', marginBottom: '0.5rem' }}>{error}</div>}

      <div style={{
        flex: 1,
        background: '#080808',
        border: '1px solid #1a1a1a',
        borderRadius: 6,
        padding: '0.75rem',
        overflowY: 'auto',
        fontFamily: 'Monaco, Menlo, "Courier New", monospace',
        fontSize: '0.73rem',
        lineHeight: 1.65,
      }}>
        {lines.length === 0 && (
          <span style={{ color: '#222' }}>Waiting for output...</span>
        )}
        {lines.map((l, i) => (
          <div key={i} style={{ display: 'flex', gap: '0.75rem' }}>
            <span style={{ color: '#222', whiteSpace: 'nowrap', flexShrink: 0 }}>
              {new Date(l.ts).toLocaleTimeString()}
            </span>
            <span style={{ color: dimLine(l.line) }}>{l.line}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
