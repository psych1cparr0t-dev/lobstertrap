import chalk from 'chalk';
import { initOpenClaw } from './cli/commands/init-openclaw';
import { newAgent } from './cli/commands/new';
import { deployAgent } from './cli/commands/deploy';
import { listAgents } from './cli/commands/list';
import { agentStatus } from './cli/commands/status';
import { agentLogs } from './cli/commands/logs';
import { stopAgent } from './cli/commands/stop';
import { scaleAgent } from './cli/commands/scale';
import { restartAgent } from './cli/commands/restart';
import { connectIntegration } from './cli/commands/connect';
import { agentMetrics } from './cli/commands/metrics';
import { openDashboard } from './cli/commands/dashboard';
import { runDoctor } from './cli/commands/doctor';
import { showHelp } from './cli/commands/help';
import { loginUser } from './cli/commands/login';

const COMMANDS: Record<string, (args: string[]) => Promise<void>> = {
  'init-openclaw': (args) => initOpenClaw(args),
  'new': (args) => newAgent(args),
  'deploy': (args) => deployAgent(args),
  'list': (args) => listAgents(args),
  'status': (args) => agentStatus(args),
  'logs': (args) => agentLogs(args),
  'stop': (args) => stopAgent(args),
  'scale': (args) => scaleAgent(args),
  'restart': (args) => restartAgent(args),
  'connect': (args) => connectIntegration(args),
  'metrics': (args) => agentMetrics(args),
  'dashboard': (args) => openDashboard(args),
  'doctor': (args) => runDoctor(args),
  'login': (args) => loginUser(args),
  'help': (args) => showHelp(args),
};

export async function run(argv: string[]): Promise<void> {
  const [command, ...args] = argv;

  if (!command || command === '--help' || command === '-h') {
    await showHelp([]);
    return;
  }

  if (command === '--version' || command === '-v') {
    const pkg = require('../package.json');
    console.log(`lobstertrap v${pkg.version}`);
    return;
  }

  const handler = COMMANDS[command];
  if (!handler) {
    console.error(chalk.red(`Unknown command: ${command}`));
    console.log(`Run ${chalk.cyan('lobstertrap help')} to see available commands.`);
    process.exit(1);
  }

  await handler(args);
}
