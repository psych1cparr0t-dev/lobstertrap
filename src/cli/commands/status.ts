import chalk from 'chalk';
import axios from 'axios';
import { loadState } from './init-openclaw';
import { getDockerStatus, getDockerStats } from '../../utils/docker';

export async function agentStatus(args: string[]): Promise<void> {
  const agentName = args[0];
  if (!agentName) {
    console.error(chalk.red('Usage: lobstertrap status <agent-name>'));
    process.exit(1);
  }

  const state = loadState();
  const agents = (state.agents as Record<string, unknown>[]) ?? [];
  const agent = agents.find((a) => a.name === agentName);

  if (!agent) {
    console.error(chalk.red(`Agent not found: ${agentName}`));
    console.log(`  Run ${chalk.cyan('lobstertrap list')} to see all agents.\n`);
    process.exit(1);
  }

  console.log(chalk.cyan(`\n🦞 Agent Status: ${agentName}\n`));

  const dockerStatus = await getDockerStatus(agentName).catch(() => 'unknown');
  const statusColor = dockerStatus === 'running' ? chalk.green : dockerStatus === 'exited' ? chalk.red : chalk.yellow;

  console.log(`  ${chalk.bold('Template:')}     ${agent.template}`);
  console.log(`  ${chalk.bold('Port:')}         ${agent.port}`);
  console.log(`  ${chalk.bold('Container:')}    ${statusColor(dockerStatus)}`);
  console.log(`  ${chalk.bold('Created:')}      ${new Date(agent.createdAt as string).toLocaleString()}`);
  console.log(`  ${chalk.bold('Integrations:')} ${((agent.integrations as string[]) ?? []).join(', ') || 'none'}`);

  if (dockerStatus === 'running') {
    const healthUrl = `http://localhost:${agent.port}/health`;
    try {
      const res = await axios.get(healthUrl, { timeout: 2000 });
      const healthy = res.data?.status === 'healthy';
      console.log(`  ${chalk.bold('Health:')}       ${healthy ? chalk.green('healthy') : chalk.yellow('degraded')}`);
    } catch {
      console.log(`  ${chalk.bold('Health:')}       ${chalk.yellow('unreachable')}`);
    }

    const stats = await getDockerStats(agentName).catch(() => null);
    if (stats) {
      console.log(`  ${chalk.bold('CPU:')}          ${stats.cpu}`);
      console.log(`  ${chalk.bold('Memory:')}       ${stats.memory}`);
    }
  }

  console.log('');
}
