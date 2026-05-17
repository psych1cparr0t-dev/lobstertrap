import chalk from 'chalk';
import { spawn } from 'child_process';
import { loadState } from './init-openclaw';

export async function agentLogs(args: string[]): Promise<void> {
  const agentName = args[0];
  const follow = args.includes('-f') || args.includes('--follow');
  const tail = (() => {
    const idx = args.indexOf('--tail');
    return idx !== -1 ? args[idx + 1] : '50';
  })();

  if (!agentName) {
    console.error(chalk.red('Usage: lobstertrap logs <agent-name> [-f] [--tail <n>]'));
    process.exit(1);
  }

  const state = loadState();
  const agents = (state.agents as Record<string, unknown>[]) ?? [];
  const agent = agents.find((a) => a.name === agentName);

  if (!agent) {
    console.error(chalk.red(`Agent not found: ${agentName}`));
    process.exit(1);
  }

  const containerName = agentName.toLowerCase().replace(/\s+/g, '-');
  const dockerArgs = ['logs', `--tail=${tail}`, ...(follow ? ['-f'] : []), containerName];

  console.log(chalk.cyan(`\n🦞 Logs: ${agentName}`) + chalk.gray(follow ? ' (streaming, Ctrl+C to stop)\n' : '\n'));

  const proc = spawn('docker', dockerArgs, { stdio: 'inherit' });

  proc.on('error', (err) => {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.error(chalk.red('Docker not found. Is it installed and running?'));
    } else {
      console.error(chalk.red(`Failed to get logs: ${err.message}`));
    }
    process.exit(1);
  });

  proc.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.log(chalk.yellow(`\nContainer "${containerName}" may not be running.`));
      console.log(`  Check status: ${chalk.cyan(`lobstertrap status ${agentName}`)}\n`);
    }
  });
}
