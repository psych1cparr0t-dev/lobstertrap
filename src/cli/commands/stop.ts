import chalk from 'chalk';
import ora from 'ora';
import { execSync } from 'child_process';
import { loadState } from './init-openclaw';

export async function stopAgent(args: string[]): Promise<void> {
  const agentName = args[0];
  if (!agentName) {
    console.error(chalk.red('Usage: lobstertrap stop <agent-name>'));
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
  const spinner = ora(`Stopping ${agentName}...`).start();

  try {
    execSync(`docker stop ${containerName}`, { stdio: 'ignore' });
    spinner.succeed(`${agentName} stopped`);
  } catch {
    spinner.warn(`Container "${containerName}" may already be stopped`);
  }

  console.log(`  Restart: ${chalk.cyan(`lobstertrap restart ${agentName}`)}\n`);
}
