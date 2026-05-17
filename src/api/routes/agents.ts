import { Router, Request, Response } from 'express';
import { execSync } from 'child_process';
import axios from 'axios';
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

function getContainerStatus(name: string): string {
  try {
    return execSync(`docker inspect --format='{{.State.Status}}' ${name}`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim().replace(/'/g, '');
  } catch {
    return 'not found';
  }
}

function getContainerMetrics(name: string): Record<string, string> | null {
  try {
    const format = '{{.CPUPerc}}|{{.MemUsage}}|{{.NetIO}}|{{.BlockIO}}|{{.PIDs}}';
    const result = execSync(`docker stats ${name} --no-stream --format "${format}"`, {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();

    const [cpu, memUsage, netIO, blockIO, pids] = result.split('|');
    const [memory, memoryLimit] = (memUsage || '').split(' / ');
    const [networkIn, networkOut] = (netIO || '').split(' / ');
    const [blockRead, blockWrite] = (blockIO || '').split(' / ');

    return { cpu: cpu || '0%', memory: memory || '0B', memoryLimit: memoryLimit || '0B', networkIn: networkIn || '0B', networkOut: networkOut || '0B', blockRead: blockRead || '0B', blockWrite: blockWrite || '0B', pids: pids || '0' };
  } catch {
    return null;
  }
}

router.get('/', (_req: Request, res: Response) => {
  const state = loadState();
  const agents = (state.agents as Record<string, unknown>[]) ?? [];

  const enriched = agents.map((agent) => {
    const containerName = (agent.name as string).toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const dockerStatus = getContainerStatus(containerName);
    return { ...agent, dockerStatus };
  });

  res.json(enriched);
});

router.get('/:name', (req: Request, res: Response) => {
  const state = loadState();
  const agents = (state.agents as Record<string, unknown>[]) ?? [];
  const agent = agents.find((a) => a.name === req.params.name);

  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  const containerName = (agent.name as string).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const dockerStatus = getContainerStatus(containerName);

  res.json({ ...agent, dockerStatus });
});

router.get('/:name/metrics', async (req: Request, res: Response) => {
  const state = loadState();
  const agents = (state.agents as Record<string, unknown>[]) ?? [];
  const agent = agents.find((a) => a.name === req.params.name);

  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  const containerName = (agent.name as string).toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const metrics = getContainerMetrics(containerName);

  // Try to get agent-level metrics from /metrics endpoint
  let agentMetrics: Record<string, unknown> = {};
  try {
    const r = await axios.get(`http://localhost:${agent.port}/metrics`, { timeout: 1500 });
    agentMetrics = r.data;
  } catch {}

  res.json({
    name: agent.name,
    docker: metrics,
    agent: agentMetrics,
    timestamp: new Date().toISOString(),
  });
});

router.get('/:name/health', async (req: Request, res: Response) => {
  const state = loadState();
  const agents = (state.agents as Record<string, unknown>[]) ?? [];
  const agent = agents.find((a) => a.name === req.params.name);

  if (!agent) {
    res.status(404).json({ error: 'Agent not found' });
    return;
  }

  try {
    const r = await axios.get(`http://localhost:${agent.port}/health`, { timeout: 2000 });
    res.json({ healthy: true, data: r.data });
  } catch {
    res.json({ healthy: false, data: null });
  }
});

export default router;
