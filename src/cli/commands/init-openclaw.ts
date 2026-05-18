import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { requireDependencies, checkDependencies, printMissingDeps } from '../../utils/dependencies';

const OPENCLAW_DIR = path.join(os.homedir(), '.lobstertrap', 'openclaw');
const STATE_FILE   = path.join(os.homedir(), '.lobstertrap', 'state.json');

export async function initOpenClaw(_args: string[]): Promise<void> {
  console.log(chalk.cyan('\n🦞 LobsterTrap Setup\n'));
  console.log('  We\'ll get everything ready in a few steps.\n');

  // ── Step 1: Dependencies ──────────────────────────────────────────────────
  console.log(chalk.bold('Step 1 — Checking your system'));
  const { missing, warnings } = await checkDependencies();
  if (missing.length > 0) {
    printMissingDeps(missing, warnings);
    console.log(chalk.red('\nInstall the above and re-run: ') + chalk.cyan('lobstertrap setup\n'));
    process.exit(1);
  }
  if (warnings.length > 0) printMissingDeps([], warnings);
  console.log(chalk.green('  ✓ All system dependencies are ready\n'));

  // ── Step 2: Anthropic API key ─────────────────────────────────────────────
  const existingKey = loadState().anthropicApiKey as string | undefined;

  if (existingKey) {
    console.log(chalk.bold('Step 2 — Anthropic API key'));
    console.log(chalk.green(`  ✓ Already saved (${maskKey(existingKey)})\n`));
  } else {
    await setupApiKey();
  }

  // ── Step 3: OpenClaw local runtime ───────────────────────────────────────
  console.log(chalk.bold('Step 3 — OpenClaw runtime'));
  if (isInitialized()) {
    console.log(chalk.green('  ✓ Already initialized at ' + OPENCLAW_DIR + '\n'));
  } else {
    await bootstrapOpenClaw();
    saveState({ initialized: true, installedAt: new Date().toISOString() });
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  console.log(chalk.green('✓ LobsterTrap is ready!\n'));
  console.log(`  Create your first agent:`);
  console.log(`    ${chalk.cyan('lobstertrap new')}\n`);
}

async function setupApiKey(): Promise<void> {
  console.log(chalk.bold('Step 2 — Anthropic API key'));
  console.log('');
  console.log('  LobsterTrap uses Claude (by Anthropic) to power your agents.');
  console.log('  You\'ll need a free API key — it takes about 2 minutes to get one.\n');

  const { hasAccount } = await inquirer.prompt([{
    type: 'confirm',
    name: 'hasAccount',
    message: 'Do you already have an Anthropic account?',
    default: false,
  }]);

  if (!hasAccount) {
    console.log('\n  Opening the Anthropic signup page in your browser...');
    openUrl('https://console.anthropic.com/');
    console.log(chalk.gray('  → Create a free account, then come back here.\n'));
    await inquirer.prompt([{
      type: 'input',
      name: '_',
      message: 'Press Enter once you\'ve created your account...',
    }]);
  }

  console.log('\n  Opening your API keys page in your browser...');
  openUrl('https://console.anthropic.com/settings/keys');
  console.log(chalk.gray('  → Click "Create Key", give it any name, and copy the key.\n'));

  const { apiKey } = await inquirer.prompt([{
    type: 'password',
    name: 'apiKey',
    message: 'Paste your Anthropic API key here:',
    mask: '•',
    validate: (input: string) => {
      if (!input.trim().startsWith('sk-ant-')) {
        return 'That doesn\'t look right — Anthropic keys start with "sk-ant-". Try again.';
      }
      return true;
    },
  }]);

  const key = apiKey.trim();

  const spinner = ora('Verifying your API key...').start();
  const valid = await verifyApiKey(key);
  if (!valid) {
    spinner.fail('That API key didn\'t work.');
    console.log(chalk.yellow('\n  Double-check you copied the full key and try again:'));
    console.log(`    ${chalk.cyan('lobstertrap setup')}\n`);
    process.exit(1);
  }
  spinner.succeed('API key verified');

  saveState({ anthropicApiKey: key });
  console.log(chalk.gray(`  Saved. All future agents will use this key automatically.\n`));
}

async function verifyApiKey(key: string): Promise<boolean> {
  try {
    const https = require('https');
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
    });

    return await new Promise((resolve) => {
      const req = https.request(
        {
          hostname: 'api.anthropic.com',
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
          },
        },
        (res: any) => resolve(res.statusCode === 200)
      );
      req.on('error', () => resolve(false));
      req.setTimeout(8000, () => { req.destroy(); resolve(false); });
      req.write(body);
      req.end();
    });
  } catch {
    return false;
  }
}

async function bootstrapOpenClaw(): Promise<void> {
  const spinner = ora('Setting up OpenClaw runtime...').start();
  try {
    fs.mkdirSync(OPENCLAW_DIR, { recursive: true });
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });

    const bootstrapPath = path.join(OPENCLAW_DIR, 'openclaw.sh');
    fs.writeFileSync(bootstrapPath, `#!/bin/bash\necho "OpenClaw runtime v0.1.0"\necho "Agent: $1"\necho "Status: running"\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(OPENCLAW_DIR, 'config.yaml'), `apiVersion: openclaw/v1\nruntime: local\nport_range: "8000-8099"\n`);

    spinner.succeed('OpenClaw runtime ready');
  } catch (err: any) {
    spinner.fail('Failed to set up OpenClaw');
    throw err;
  }
}

function openUrl(url: string): void {
  try {
    const platform = process.platform;
    if (platform === 'darwin') execSync(`open "${url}"`, { stdio: 'ignore' });
    else if (platform === 'win32') execSync(`start "${url}"`, { stdio: 'ignore' });
    else execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
  } catch {
    console.log(chalk.gray(`  (couldn't auto-open browser — visit: ${url})`));
  }
}

function maskKey(key: string): string {
  return key.slice(0, 12) + '••••••••' + key.slice(-4);
}

function isInitialized(): boolean {
  return fs.existsSync(STATE_FILE) && fs.existsSync(OPENCLAW_DIR);
}

function saveState(patch: Record<string, unknown>): void {
  const existing = loadState();
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ ...existing, ...patch }, null, 2));
}

export function loadState(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}
