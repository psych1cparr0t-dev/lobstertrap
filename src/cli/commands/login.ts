import chalk from 'chalk';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadState } from './init-openclaw';

const STATE_FILE = path.join(os.homedir(), '.lobstertrap', 'state.json');

const PLAN_LIMITS: Record<string, number> = {
  free: 1,
  pro: 5,
  team: Infinity,
};

// Key format: LT-PRO-XXXX-XXXX or LT-TEAM-XXXX-XXXX
function parseKey(key: string): { plan: string } | null {
  const match = key.trim().toUpperCase().match(/^LT-(PRO|TEAM)-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  if (!match) return null;
  return { plan: match[1].toLowerCase() };
}

export async function loginUser(args: string[]): Promise<void> {
  const key = args[0];

  if (!key) {
    console.error(chalk.red('Usage: lobstertrap login <license-key>'));
    console.log(`  Get your key at: ${chalk.cyan('https://lobstertrap.dev/upgrade')}\n`);
    process.exit(1);
  }

  const parsed = parseKey(key);
  if (!parsed) {
    console.error(chalk.red('Invalid license key format.'));
    console.log(`  Expected format: ${chalk.gray('LT-PRO-XXXX-XXXX')} or ${chalk.gray('LT-TEAM-XXXX-XXXX')}`);
    console.log(`  Get a key at:    ${chalk.cyan('https://lobstertrap.dev/upgrade')}\n`);
    process.exit(1);
  }

  const state = loadState();
  const previousPlan = (state.plan as string) ?? 'free';
  const newPlan = parsed.plan;
  const limit = PLAN_LIMITS[newPlan];

  const updated = { ...state, licenseKey: key.trim(), plan: newPlan };
  fs.writeFileSync(STATE_FILE, JSON.stringify(updated, null, 2));

  const limitLabel = limit === Infinity ? 'unlimited' : String(limit);
  console.log(`
${chalk.green('✓ License activated')}

  ${chalk.bold('Plan:')}  ${chalk.cyan(newPlan.charAt(0).toUpperCase() + newPlan.slice(1))}
  ${chalk.bold('Agents:')} Up to ${limitLabel} active agent${limit === 1 ? '' : 's'}
  ${previousPlan !== newPlan ? chalk.gray(`  (upgraded from ${previousPlan})`) : ''}

  Deploy your agents: ${chalk.cyan('lobstertrap deploy <agent>')}
`);
}
