import React, { useState, useRef, useEffect } from 'react';
import { Agent } from '../types';

interface Message {
  role: 'user' | 'agent';
  content: string;
  ts: number;
}

const SESSION_ID = Math.random().toString(36).slice(2);

export default function ChatBar({ agent }: { agent: Agent }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMessages([]);
    setError(null);
    setInput('');
    inputRef.current?.focus();
  }, [agent.name]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const isConfigCommand = (text: string) =>
    text.startsWith('/config ') || text.toLowerCase().startsWith('/configure ');

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: Message = { role: 'user', content: text, ts: Date.now() };
    setMessages((m) => [...m, userMsg]);
    setInput('');
    setLoading(true);
    setError(null);

    const configuring = isConfigCommand(text);
    const instruction = configuring ? text.replace(/^\/configur?e? /i, '').trim() : null;

    try {
      const endpoint = configuring ? 'configure' : 'chat';
      const body = configuring
        ? { instruction }
        : { message: text, session_id: SESSION_ID };

      const res = await fetch(`http://localhost:${agent.port}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`Agent returned ${res.status}`);

      const data = await res.json();

      if (configuring) {
        const preview = (data.system_prompt as string ?? '').slice(0, 120);
        setMessages((m) => [...m, {
          role: 'agent',
          content: `System prompt updated.\n\nPreview: ${preview}${preview.length === 120 ? '…' : ''}`,
          ts: Date.now(),
        }]);
      } else {
        const reply = data.reply ?? data.response ?? JSON.stringify(data);
        setMessages((m) => [...m, { role: 'agent', content: reply, ts: Date.now() }]);
      }
    } catch (e: any) {
      setError(
        agent.dockerStatus !== 'running'
          ? `Agent is not running. Deploy with: lobstertrap deploy ${agent.name}`
          : 'Could not reach agent: ' + e.message
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0a0a0a' }}>
      <div style={{
        flex: 1, overflowY: 'auto',
        padding: '1rem 1.25rem',
        display: 'flex', flexDirection: 'column', gap: '0.625rem',
      }}>
        {messages.length === 0 && !error && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '100%', gap: '0.4rem', color: '#2a2a2a',
          }}>
            <span style={{ fontSize: '0.85rem' }}>Chat with {agent.name}</span>
            <span style={{ fontSize: '0.75rem', color: '#222', textAlign: 'center', maxWidth: 300 }}>
              Type <code style={{ fontFamily: 'monospace', color: '#333' }}>/config be more concise</code> to update behaviour live.
            </span>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.ts} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '72%',
              background: msg.role === 'user' ? '#111' : '#0f0f0f',
              border: `1px solid ${msg.role === 'user' ? '#222' : '#1a1a1a'}`,
              borderRadius: msg.role === 'user' ? '10px 10px 2px 10px' : '10px 10px 10px 2px',
              padding: '0.5rem 0.8rem',
              fontSize: '0.85rem',
              lineHeight: 1.55,
              color: msg.role === 'user' ? '#c0c0c0' : '#888',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {msg.content}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{
              background: '#0f0f0f', border: '1px solid #1a1a1a',
              borderRadius: '10px 10px 10px 2px',
              padding: '0.5rem 0.8rem',
              display: 'flex', gap: 4, alignItems: 'center',
            }}>
              {[0, 1, 2].map((i) => (
                <span key={i} style={{
                  width: 5, height: 5, borderRadius: '50%', background: '#333',
                  animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                }} />
              ))}
            </div>
          </div>
        )}

        {error && (
          <div style={{
            background: '#0f0f0f', border: '1px solid #222',
            borderRadius: 6, padding: '0.6rem 0.85rem',
            fontSize: '0.8rem', color: '#555',
          }}>
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div style={{
        borderTop: '1px solid #1a1a1a',
        padding: '0.75rem 1.25rem',
        display: 'flex', gap: '0.5rem', alignItems: 'center',
        background: '#0d0d0d', flexShrink: 0,
      }}>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder={`Message ${agent.name}...`}
          style={{
            flex: 1,
            background: '#111', border: '1px solid #1e1e1e',
            borderRadius: 6, padding: '0.5rem 0.8rem',
            color: '#c0c0c0', fontSize: '0.85rem', outline: 'none',
            fontFamily: 'inherit',
          }}
          disabled={loading}
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          style={{
            background: 'none',
            border: `1px solid ${input.trim() && !loading ? '#333' : '#1a1a1a'}`,
            borderRadius: 6,
            padding: '0.5rem 1rem',
            color: input.trim() && !loading ? '#888' : '#2e2e2e',
            cursor: input.trim() && !loading ? 'pointer' : 'default',
            fontSize: '0.82rem',
            flexShrink: 0,
          }}
        >
          send
        </button>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.2; transform: scale(0.8); }
          50% { opacity: 0.6; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
