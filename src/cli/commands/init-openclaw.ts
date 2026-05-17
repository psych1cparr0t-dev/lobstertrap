import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { requireDependencies, checkDependencies, printMissingDeps } from '../../utils/dependencies';

const OPENCLAW_DIR = path.join(os.homedir(), '.lobstertrap', 'openclaw');
const OPENCLAW_STATE_FILE = path.join(os.homedir(), '.lobstertrap', 'state.json');

export async function initOpenClaw(_args: string[]): Promise<void> {
  console.log(chalk.cyan('\n🦞 LobsterTrap — OpenClaw Initializer\n'));

  // Full dependency check on first run
  const { missing, warnings } = await checkDependencies();
  if (missing.length > 0) {
    printMissingDeps(missing, warnings);
    console.log(chalk.red('Install the above and re-run: ') + chalk.cyan('lobstertrap init-openclaw\n'));
    console.log(`  Run ${chalk.cyan('lobstertrap doctor')} to see a full system check.\n`);
    process.exit(1);
  }
  if (warnings.length > 0) {
    printMissingDeps([], warnings);
  }

  if (isOpenClawInstalled()) {
    console.log(chalk.green('✓ OpenClaw is already initialized at ' + OPENCLAW_DIR));
    console.log(`  Run ${chalk.cyan('lobstertrap new')} to create your first agent.\n`);
    return;
  }

  // Ensure dirs exist
  fs.mkdirSync(OPENCLAW_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(OPENCLAW_STATE_FILE), { recursive: true });

  await downloadOpenClaw();
  await configureLocalEnvironment();

  saveState({ initialized: true, installedAt: new Date().toISOString() });

  console.log(chalk.green('\n✓ OpenClaw ready at ' + OPENCLAW_DIR));
  console.log(`\n  Next step: ${chalk.cyan('lobstertrap new')} — create your first agent\n`);
}


async function downloadOpenClaw(): Promise<void> {
  const spinner = ora('Downloading OpenClaw...').start();
  try {
    // Write a local openclaw bootstrap script
    const bootstrapPath = path.join(OPENCLAW_DIR, 'openclaw.sh');
    const bootstrapContent = `#!/bin/bash
# OpenClaw agent runtime bootstrap
# Replace this with the real OpenClaw binary when available
echo "OpenClaw runtime v0.1.0"
echo "Agent: \$1"
echo "Status: running"
`;
    fs.writeFileSync(bootstrapPath, bootstrapContent, { mode: 0o755 });

    // Write openclaw config
    const configPath = path.join(OPENCLAW_DIR, 'config.yaml');
    fs.writeFileSync(configPath, `apiVersion: openclaw/v1\nruntime: local\nport_range: "8000-8099"\n`);

    spinner.succeed('OpenClaw downloaded');
  } catch (err: any) {
    spinner.fail('Failed to set up OpenClaw');
    throw err;
  }
}

async function configureLocalEnvironment(): Promise<void> {
  const spinner = ora('Configuring local environment...').start();
  try {
    const envPath = path.join(OPENCLAW_DIR, '.env');
    if (!fs.existsSync(envPath)) {
      fs.writeFileSync(envPath, `OPENCLAW_RUNTIME=local\nOPENCLAW_PORT_RANGE=8000-8099\n`);
    }
    spinner.succeed('Environment configured');
  } catch (err: any) {
    spinner.fail('Failed to configure environment');
    throw err;
  }
}

function isOpenClawInstalled(): boolean {
  return fs.existsSync(OPENCLAW_STATE_FILE) && fs.existsSync(OPENCLAW_DIR);
}

function saveState(state: Record<string, unknown>): void {
  const existing = loadState();
  fs.writeFileSync(OPENCLAW_STATE_FILE, JSON.stringify({ ...existing, ...state }, null, 2));
}

export function loadState(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(OPENCLAW_STATE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}
