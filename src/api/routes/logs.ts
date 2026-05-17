import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const router = Router();
const STATE_FILE = path.join(os.homedir(), '.lobstertrap', 'state.json');

function loadState(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

// Server-sent events stream for live logs
router.get('/:name/stream', (req: Request, res: Response) => {
  const state = loadState();
  const agents = (state.agents as Record<string, unknown>[]) ?? [];
  const agent = agents.find((a) => a.name === req.params.name);

  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  const containerName = (agent.name as string).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const tail = (req.query.tail as string) || '100';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const proc = spawn('docker', ['logs', '--tail', tail, '-f', containerName]);

  const send = (data: string) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      res.write(`data: ${JSON.stringify({ line, ts: new Date().toISOString() })}\n\n`);
    }
  };

  proc.stdout.on('data', send);
  proc.stderr.on('data', send);

  proc.on('error', () => {
    res.write(`data: ${JSON.stringify({ line: '[container not running]', ts: new Date().toISOString() })}\n\n`);
    res.end();
  });

  req.on('close', () => {
    proc.kill();
    res.end();
  });
});

// Snapshot — last N lines
router.get('/:name', (req: Request, res: Response) => {
  const state = loadState();
  const agents = (state.agents as Record<string, unknown>[]) ?? [];
  const agent = agents.find((a) => a.name === req.params.name);

  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  const containerName = (agent.name as string).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const tail = (req.query.tail as string) || '100';

  const proc = spawn('docker', ['logs', '--tail', tail, '--timestamps', containerName]);
  const lines: string[] = [];

  proc.stdout.on('data', (d) => lines.push(...d.toString().split('\n').filter(Boolean)));
  proc.stderr.on('data', (d) => lines.push(...d.toString().split('\n').filter(Boolean)));

  proc.on('close', () => {
    res.json({ name: req.params.name, lines });
  });

  proc.on('error', () => {
    res.json({ name: req.params.name, lines: ['Container not running'] });
  });
});

export default router;
