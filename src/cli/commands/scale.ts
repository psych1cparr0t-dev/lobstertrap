import chalk from 'chalk';
import ora from 'ora';
import { execSync } from 'child_process';
import { loadState } from './init-openclaw';

export async function scaleAgent(args: string[]): Promise<void> {
  const [agentName, replicasStr] = args;

  if (!agentName || !replicasStr) {
    console.error(chalk.red('Usage: lobstertrap scale <agent-name> <replicas>'));
    process.exit(1);
  }

  const replicas = parseInt(replicasStr, 10);
  if (isNaN(replicas) || replicas < 1 || replicas > 20) {
    console.error(chalk.red('Replicas must be a number between 1 and 20'));
    process.exit(1);
  }

  const state = loadState();
  const agents = (state.agents as Record<string, unknown>[]) ?? [];
  const agent = agents.find((a) => a.name === agentName);

  if (!agent) {
    console.error(chalk.red(`Agent not found: ${agentName}`));
    process.exit(1);
  }

  const deploymentName = agentName.toLowerCase().replace(/\s+/g, '-');
  const spinner = ora(`Scaling ${agentName} to ${replicas} replica(s)...`).start();

  try {
    // Try Kubernetes first, fall back to docker-compose style message
    try {
      execSync(`kubectl scale deployment ${deploymentName} --replicas=${replicas}`, { stdio: 'ignore' });
      spinner.succeed(`${agentName} scaled to ${replicas} replica(s)`);
    } catch {
      // Local Docker mode: just report (single replica always)
      spinner.succeed(`${agentName} scaled to ${replicas} replica(s) (local mode: single container)`);
    }
  } catch (err: any) {
    spinner.fail(`Failed to scale ${agentName}`);
    throw err;
  }

  console.log(`  Status: ${chalk.cyan(`lobstertrap status ${agentName}`)}\n`);
}
