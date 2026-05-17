import chalk from 'chalk';
import { execSync, spawnSync } from 'child_process';
import axios from 'axios';
import { loadState } from './init-openclaw';

interface Metrics {
  cpu: string;
  memory: string;
  memoryLimit: string;
  networkIn: string;
  networkOut: string;
  blockRead: string;
  blockWrite: string;
  pids: string;
}

export async function agentMetrics(args: string[]): Promise<void> {
  const agentName = args[0];
  const watch = args.includes('-w') || args.includes('--watch');

  if (!agentName) {
    console.error(chalk.red('Usage: lobstertrap metrics <agent-name> [-w]'));
    process.exit(1);
  }

  const state = loadState();
  const agents = (state.agents as Record<string, unknown>[]) ?? [];
  const agent = agents.find((a) => a.name === agentName);

  if (!agent) {
    console.error(chalk.red(`Agent not found: ${agentName}`));
    process.exit(1);
  }

  const containerName = agentName.toLowerCase().replace(/[^a-z0-9-]/g, '-');

  if (watch) {
    console.log(chalk.cyan(`\n🦞 Metrics: ${agentName}`) + chalk.gray(' (watching, Ctrl+C to stop)\n'));
    watchMetrics(containerName, agentName, agent.port as string);
  } else {
    await printMetricsOnce(containerName, agentName, agent.port as string);
  }
}

async function printMetricsOnce(containerName: string, agentName: string, port: string): Promise<void> {
  console.log(chalk.cyan(`\n🦞 Metrics: ${agentName}\n`));

  const metrics = getDockerMetrics(containerName);
  if (!metrics) {
    console.log(chalk.yellow(`  Container "${containerName}" is not running.`));
    console.log(`  Deploy it first: ${chalk.cyan(`lobstertrap deploy ${agentName}`)}\n`);
    return;
  }

  const requests = await getRequestCount(port);

  printMetricsTable(metrics, requests);
}

function watchMetrics(containerName: string, agentName: string, port: string): void {
  const refresh = async () => {
    process.stdout.write('\x1Bc'); // clear terminal
    console.log(chalk.cyan(`🦞 Metrics: ${agentName}`) + chalk.gray(`  ${new Date().toLocaleTimeString()}\n`));

    const metrics = getDockerMetrics(containerName);
    if (!metrics) {
      console.log(chalk.yellow(`Container not running. Deploy: lobstertrap deploy ${agentName}`));
      return;
    }

    const requests = await getRequestCount(port);
    printMetricsTable(metrics, requests);
    console.log(chalk.gray('\n  Refreshing every 2s — Ctrl+C to stop'));
  };

  refresh();
  const interval = setInterval(refresh, 2000);

  process.on('SIGINT', () => {
    clearInterval(interval);
    console.log('\n');
    process.exit(0);
  });
}

function getDockerMetrics(containerName: string): Metrics | null {
  try {
    const format = '{{.CPUPerc}}|{{.MemUsage}}|{{.NetIO}}|{{.BlockIO}}|{{.PIDs}}';
    const result = execSync(
      `docker stats ${containerName} --no-stream --format "${format}"`,
      { stdio: ['ignore', 'pipe', 'ignore'] }
    ).toString().trim();

    const [cpu, memUsage, netIO, blockIO, pids] = result.split('|');
    const [memory, memoryLimit] = (memUsage || '').split(' / ');
    const [networkIn, networkOut] = (netIO || '').split(' / ');
    const [blockRead, blockWrite] = (blockIO || '').split(' / ');

    return { cpu, memory, memoryLimit, networkIn, networkOut, blockRead, blockWrite, pids };
  } catch {
    return null;
  }
}

async function getRequestCount(port: string): Promise<string> {
  try {
    const res = await axios.get(`http://localhost:${port}/metrics`, { timeout: 1000 });
    return res.data?.requests_total ?? 'N/A';
  } catch {
    return 'N/A';
  }
}

function printMetricsTable(m: Metrics, requests: string): void {
  const row = (label: string, value: string, color?: (s: string) => string) => {
    const val = color ? color(value) : chalk.white(value);
    console.log(`  ${chalk.gray(label.padEnd(18))} ${val}`);
  };

  const cpuNum = parseFloat(m.cpu);
  const cpuColor = cpuNum > 80 ? chalk.red : cpuNum > 50 ? chalk.yellow : chalk.green;

  row('CPU Usage', m.cpu, cpuColor);
  row('Memory', `${m.memory} / ${m.memoryLimit}`);
  row('Network In', m.networkIn);
  row('Network Out', m.networkOut);
  row('Disk Read', m.blockRead);
  row('Disk Write', m.blockWrite);
  row('PIDs', m.pids);
  row('Requests Total', requests);

  console.log('');
}
