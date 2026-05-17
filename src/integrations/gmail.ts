import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import * as fs from 'fs';
import * as path from 'path';

export async function connectGmail(agentName: string): Promise<void> {
  console.log(chalk.bold('Gmail Integration Setup\n'));
  console.log('You need a Google Cloud OAuth2 client to connect Gmail.');
  console.log('Setup guide: https://developers.google.com/gmail/api/quickstart/python\n');

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'clientId',
      message: 'Gmail Client ID:',
      validate: (v: string) => v.trim().length > 0 || 'Required',
    },
    {
      type: 'password',
      name: 'clientSecret',
      message: 'Gmail Client Secret:',
      validate: (v: string) => v.trim().length > 0 || 'Required',
    },
    {
      type: 'password',
      name: 'refreshToken',
      message: 'Gmail Refresh Token:',
      validate: (v: string) => v.trim().length > 0 || 'Required',
    },
  ]);

  const spinner = ora('Saving Gmail credentials...').start();

  try {
    appendEnvVars(agentName, {
      GMAIL_CLIENT_ID: answers.clientId,
      GMAIL_CLIENT_SECRET: answers.clientSecret,
      GMAIL_REFRESH_TOKEN: answers.refreshToken,
    });
    spinner.succeed('Gmail connected');
    console.log(chalk.green(`\n✓ Gmail credentials saved to ${agentName}/.env`));
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
  const updated = existing + '\n' + lines + '\n';
  fs.writeFileSync(envPath, updated);
}
