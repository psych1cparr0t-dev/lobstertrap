import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import * as fs from 'fs';
import * as path from 'path';

export async function connectAirtable(agentName: string): Promise<void> {
  console.log(chalk.bold('Airtable Integration Setup\n'));
  console.log('Get your API token at: https://airtable.com/create/tokens\n');

  const answers = await inquirer.prompt([
    {
      type: 'password',
      name: 'apiToken',
      message: 'Airtable API Token:',
      validate: (v: string) => v.trim().length > 0 || 'Required',
    },
    {
      type: 'input',
      name: 'baseId',
      message: 'Airtable Base ID (e.g. appXXXXXXXX):',
      validate: (v: string) => v.startsWith('app') || 'Base ID should start with "app"',
    },
  ]);

  const spinner = ora('Saving Airtable credentials...').start();

  try {
    appendEnvVars(agentName, {
      AIRTABLE_API_TOKEN: answers.apiToken,
      AIRTABLE_BASE_ID: answers.baseId,
    });
    spinner.succeed('Airtable connected');
    console.log(chalk.green(`\n✓ Airtable credentials saved to ${agentName}/.env`));
    console.log(`  Restart the agent: ${chalk.cyan(`lobstertrap restart ${agentName}`)}\n`);
  } catch (err: any) {
    spinner.fail('Failed to save credentials');
    throw err;
  }
}

function appendEnvVars(agentName: string, vars: Record<string, string>): void {
  const envPath = path.join(process.cwd(), agentName, '.env');
  if (!fs.existsSync(envPath)) {
    throw new Error(`.env not found at ${envPath}. Run lobstertrap new first.`);
  }
  const lines = Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n');
  const existing = fs.readFileSync(envPath, 'utf-8');
  fs.writeFileSync(envPath, existing + '\n' + lines + '\n');
}
