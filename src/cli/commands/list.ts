import chalk from 'chalk';
import Table from 'cli-table3';
import { loadState } from './init-openclaw';
import { getDockerStatus } from '../../utils/docker';

export async function listAgents(_args: string[]): Promise<void> {
  const state = loadState();
  const agents = (state.agents as Record<string, unknown>[]) ?? [];

  if (agents.length === 0) {
    console.log(chalk.yellow('\nNo agents found.'));
    console.log(`  Run ${chalk.cyan('lobstertrap new')} to create your first agent.\n`);
    return;
  }

  const table = new Table({
    head: [
      chalk.bold('Name'),
      chalk.bold('Template'),
      chalk.bold('Port'),
      chalk.bold('Status'),
      chalk.bold('Integrations'),
    ],
    style: { head: [], border: [] },
  });

  for (const agent of agents) {
    const dockerStatus = await getDockerStatus(agent.name as string).catch(() => 'unknown');
    const statusColor = dockerStatus === 'running' ? chalk.green : dockerStatus === 'exited' ? chalk.red : chalk.yellow;

    table.push([
      chalk.bold(agent.name as string),
      agent.template as string,
      agent.port as string,
      statusColor(dockerStatus),
      ((agent.integrations as string[]) ?? []).join(', ') || chalk.gray('none'),
    ]);
  }

  console.log('\n' + table.toString() + '\n');
}
