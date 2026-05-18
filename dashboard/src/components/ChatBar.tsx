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

  // Reset conversation when agent changes
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
    const instruction = configuring
      ? text.replace(/^\/configur?e? /i, '').trim()
      : null;

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
          content: `🔧 System prompt updated.\n\nPreview: ${preview}${preview.length === 120 ? '…' : ''}`,
          ts: Date.now(),
        }]);
      } else {
        const reply = data.reply ?? data.response ?? JSON.stringify(data);
        setMessages((m) => [...m, { role: 'agent', content: reply, ts: Date.now() }]);
      }
    } catch (e: any) {
      setError(
        agent.dockerStatus !== 'running'
          ? 'Agent is not running. Deploy it first with: lobstertrap deploy ' + agent.name
          : 'Could not reach agent: ' + e.message
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: '#0a0a0a',
    }}>
      {/* Message list */}
      <div style={{
        flex: 1, overflowY: 'auto',
        padding: '1rem 1.25rem',
        display: 'flex', flexDirection: 'column', gap: '0.75rem',
      }}>
        {messages.length === 0 && !error && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '100%', gap: '0.5rem',
            color: '#333',
          }}>
            <span style={{ fontSize: '1.8rem' }}>💬</span>
            <span style={{ fontSize: '0.88rem' }}>Chat with {agent.name}</span>
            <span style={{ fontSize: '0.78rem', color: '#2a2a2a', textAlign: 'center', maxWidth: 320 }}>
              Ask it anything, or type{' '}
              <span style={{ fontFamily: 'monospace', color: '#444' }}>/config be more concise</span>
              {' '}to update its behaviour live — no restart needed.
            </span>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.ts}
            style={{
              display: 'flex',
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            }}
          >
            <div style={{
              maxWidth: '72%',
              background: msg.role === 'user' ? '#3a0a0a' : '#141414',
              border: `1px solid ${msg.role === 'user' ? '#5a1a1a' : '#222'}`,
              borderRadius: msg.role === 'user'
                ? '14px 14px 4px 14px'
                : '14px 14px 14px 4px',
              padding: '0.55rem 0.85rem',
              fontSize: '0.87rem',
              lineHeight: 1.55,
              color: msg.role === 'user' ? '#ffcccc' : '#d0d0d0',
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
              background: '#141414', border: '1px solid #222',
              borderRadius: '14px 14px 14px 4px',
              padding: '0.55rem 0.85rem',
              display: 'flex', gap: '4px', alignItems: 'center',
            }}>
              {[0, 1, 2].map((i) => (
                <span key={i} style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: '#444',
                  animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                }} />
              ))}
            </div>
          </div>
        )}

        {error && (
          <div style={{
            background: '#1a0a0a', border: '1px solid #3a1a1a',
            borderRadius: 10, padding: '0.65rem 0.9rem',
            fontSize: '0.82rem', color: '#f87171',
          }}>
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input row */}
      <div style={{
        borderTop: '1px solid #1a1a1a',
        padding: '0.75rem 1.25rem',
        display: 'flex', gap: '0.6rem', alignItems: 'center',
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
            background: '#141414', border: '1px solid #222',
            borderRadius: 10, padding: '0.55rem 0.9rem',
            color: '#e0e0e0', fontSize: '0.88rem', outline: 'none',
            fontFamily: 'inherit',
          }}
          disabled={loading}
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          style={{
            background: input.trim() && !loading ? '#c1121f' : '#1a1a1a',
            border: 'none', borderRadius: 10,
            padding: '0.55rem 1rem',
            color: input.trim() && !loading ? '#fff' : '#444',
            cursor: input.trim() && !loading ? 'pointer' : 'default',
            fontSize: '0.88rem', fontWeight: 600,
            transition: 'background 0.15s',
            flexShrink: 0,
          }}
        >
          Send
        </button>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
