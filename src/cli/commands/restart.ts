import chalk from 'chalk';
import ora from 'ora';
import { execSync } from 'child_process';
import { loadState } from './init-openclaw';

export async function restartAgent(args: string[]): Promise<void> {
  const agentName = args[0];
  if (!agentName) {
    console.error(chalk.red('Usage: lobstertrap restart <agent-name>'));
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
  const spinner = ora(`Restarting ${agentName}...`).start();

  try {
    execSync(`docker restart ${containerName}`, { stdio: 'ignore' });
    spinner.succeed(`${agentName} restarted`);
  } catch {
    spinner.fail(`Failed to restart ${agentName}. Is the container running?`);
    console.log(`  Check status: ${chalk.cyan(`lobstertrap status ${agentName}`)}\n`);
    process.exit(1);
  }

  console.log(`  Logs: ${chalk.cyan(`lobstertrap logs ${agentName} -f`)}\n`);
}
