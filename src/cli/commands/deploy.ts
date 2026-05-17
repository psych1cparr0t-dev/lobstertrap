import chalk from 'chalk';
import ora from 'ora';
import axios from 'axios';
import { execSync, spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { loadState } from './init-openclaw';
import { requireDependencies } from '../../utils/dependencies';

const HEALTH_POLL_INTERVAL_MS = 1500;
const HEALTH_POLL_MAX_ATTEMPTS = 20;

export async function deployAgent(args: string[]): Promise<void> {
  const agentName = args[0];

  if (!agentName) {
    console.error(chalk.red('Usage: lobstertrap deploy <agent-name>'));
    process.exit(1);
  }

  await requireDependencies(['Docker', 'Docker daemon']);

  const state = loadState();
  const agents = (state.agents as Record<string, unknown>[]) ?? [];
  const agent = agents.find((a) => a.name === agentName);

  if (!agent) {
    console.error(chalk.red(`Agent not found: ${agentName}`));
    console.log(`  Run ${chalk.cyan('lobstertrap new')} to create an agent first.\n`);
    process.exit(1);
  }

  const agentDir = agent.dir as string;

  if (!fs.existsSync(agentDir)) {
    console.error(chalk.red(`Agent directory not found: ${agentDir}`));
    console.log(`  Re-run ${chalk.cyan('lobstertrap new')} to regenerate it.\n`);
    process.exit(1);
  }

  const envPath = path.join(agentDir, '.env');
  if (!fs.existsSync(envPath)) {
    console.error(chalk.red(`.env not found in ${agentDir}`));
    console.log(`  Create a .env file with at least ANTHROPIC_API_KEY=<your-key>\n`);
    process.exit(1);
  }

  warnIfMissingApiKey(envPath);

  const imageName = agentName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const containerName = imageName;
  const port = agent.port as string;

  console.log(chalk.cyan(`\n🦞 Deploying ${agentName}\n`));

  // Stop existing container if running
  await stopExistingContainer(containerName);

  // Build
  await buildImage(agentDir, imageName);

  // Run
  await runContainer(containerName, imageName, port, envPath);

  // Health check
  await pollHealth(agentName, port);

  // Persist running status
  updateAgentStatus(agents, agentName, 'running', state);

  console.log(`
${chalk.green('✓ ' + agentName + ' is live')}

  ${chalk.bold('URL:')}    http://localhost:${port}
  ${chalk.bold('Health:')} http://localhost:${port}/health

  ${chalk.gray('Logs:')}   lobstertrap logs ${agentName} -f
  ${chalk.gray('Stop:')}   lobstertrap stop ${agentName}
`);
}

async function stopExistingContainer(containerName: string): Promise<void> {
  const spinner = ora(`Checking for existing container...`).start();
  try {
    execSync(`docker stop ${containerName}`, { stdio: 'ignore' });
    execSync(`docker rm ${containerName}`, { stdio: 'ignore' });
    spinner.succeed('Removed previous container');
  } catch {
    spinner.stop();
  }
}

async function buildImage(agentDir: string, imageName: string): Promise<void> {
  const spinner = ora(`Building Docker image ${chalk.bold(imageName)}...`).start();
  const result = spawnSync('docker', ['build', '-t', imageName, agentDir], {
    encoding: 'utf-8',
  });

  if (result.status !== 0) {
    spinner.fail('Docker build failed');
    console.error('\n' + chalk.red(result.stderr || result.stdout));
    console.log(chalk.yellow('\nCommon fixes:'));
    console.log('  • Make sure Docker Desktop is running');
    console.log('  • Check your Dockerfile syntax');
    console.log(`  • Try manually: ${chalk.cyan(`docker build -t ${imageName} ${agentDir}`)}\n`);
    process.exit(1);
  }

  spinner.succeed(`Image built: ${imageName}`);
}

async function runContainer(
  containerName: string,
  imageName: string,
  port: string,
  envFile: string
): Promise<void> {
  const spinner = ora(`Starting container...`).start();
  const result = spawnSync(
    'docker',
    ['run', '-d', '--name', containerName, '-p', `${port}:${port}`, '--env-file', envFile, imageName],
    { encoding: 'utf-8' }
  );

  if (result.status !== 0) {
    spinner.fail('Failed to start container');
    console.error('\n' + chalk.red(result.stderr || result.stdout));
    console.log(chalk.yellow('\nCommon fixes:'));
    console.log(`  • Port ${port} may be in use — try a different port in your openclaw-deployment.yaml`);
    console.log(`  • Check .env file has correct values\n`);
    process.exit(1);
  }

  spinner.succeed(`Container started`);
}

async function pollHealth(agentName: string, port: string): Promise<void> {
  const spinner = ora('Waiting for agent to become healthy...').start();
  const url = `http://localhost:${port}/health`;

  for (let i = 0; i < HEALTH_POLL_MAX_ATTEMPTS; i++) {
    await sleep(HEALTH_POLL_INTERVAL_MS);
    try {
      const res = await axios.get(url, { timeout: 1000 });
      if (res.data?.status === 'healthy') {
        spinner.succeed('Agent is healthy');
        return;
      }
    } catch {
      // still starting up
    }
    spinner.text = `Waiting for agent... (${i + 1}/${HEALTH_POLL_MAX_ATTEMPTS})`;
  }

  spinner.warn('Agent started but health check timed out');
  console.log(chalk.yellow(`\n  The container is running but /health didn't respond within ${HEALTH_POLL_MAX_ATTEMPTS * HEALTH_POLL_INTERVAL_MS / 1000}s.`));
  console.log(`  Check logs: ${chalk.cyan(`lobstertrap logs ${agentName}`)}\n`);
}

function warnIfMissingApiKey(envPath: string): void {
  const content = fs.readFileSync(envPath, 'utf-8');
  const match = content.match(/^ANTHROPIC_API_KEY=(.*)$/m);
  if (!match || !match[1].trim()) {
    console.log(chalk.yellow('⚠ ANTHROPIC_API_KEY is not set in .env'));
    console.log(`  Get your key at: https://console.anthropic.com/settings/keys`);
    console.log(`  Add it to: ${envPath}\n`);
  }
}

function updateAgentStatus(
  agents: Record<string, unknown>[],
  agentName: string,
  status: string,
  state: Record<string, unknown>
): void {
  const updated = agents.map((a) =>
    a.name === agentName ? { ...a, status, lastDeployedAt: new Date().toISOString() } : a
  );
  const stateFile = require('path').join(require('os').homedir(), '.lobstertrap', 'state.json');
  fs.writeFileSync(stateFile, JSON.stringify({ ...state, agents: updated }, null, 2));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
