import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import * as fs from 'fs';
import * as path from 'path';

export async function connectTwilio(agentName: string): Promise<void> {
  console.log(chalk.bold('Twilio Integration Setup\n'));
  console.log('Twilio enables phone calls and SMS for your agent.');
  console.log('Get your credentials at: https://console.twilio.com\n');

  console.log(chalk.bold('You\'ll need:'));
  console.log('  1. Account SID and Auth Token (from Console Dashboard)');
  console.log('  2. A Twilio phone number capable of Voice + SMS');
  console.log('  3. Your agent\'s public URL for webhooks (use ngrok in dev)\n');

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'accountSid',
      message: 'Twilio Account SID (ACxxxxxx):',
      validate: (v: string) => v.startsWith('AC') || 'Account SID starts with AC',
    },
    {
      type: 'password',
      name: 'authToken',
      message: 'Twilio Auth Token:',
      validate: (v: string) => v.trim().length > 0 || 'Required',
    },
    {
      type: 'input',
      name: 'phoneNumber',
      message: 'Twilio phone number (e.g. +14155551234):',
      validate: (v: string) => v.startsWith('+') || 'Include country code, e.g. +14155551234',
    },
    {
      type: 'input',
      name: 'publicUrl',
      message: 'Your agent\'s public URL (for webhooks, e.g. https://abc.ngrok.io):',
      validate: (v: string) => v.startsWith('http') || 'Must be a full URL',
    },
    {
      type: 'input',
      name: 'escalationNumber',
      message: 'Escalation phone number (optional, for human handoff):',
    },
  ]);

  const spinner = ora('Saving Twilio credentials...').start();

  try {
    appendEnvVars(agentName, {
      TWILIO_ACCOUNT_SID: answers.accountSid,
      TWILIO_AUTH_TOKEN: answers.authToken,
      TWILIO_PHONE_NUMBER: answers.phoneNumber,
      PUBLIC_URL: answers.publicUrl,
      ...(answers.escalationNumber ? { ESCALATION_PHONE_NUMBER: answers.escalationNumber } : {}),
    });
    spinner.succeed('Twilio credentials saved');
  } catch (err: any) {
    spinner.fail('Failed to save credentials');
    throw err;
  }

  const port = getAgentPort(agentName) || '8000';
  const publicUrl = answers.publicUrl.replace(/\/$/, '');

  console.log(chalk.green(`\n✓ Twilio connected to ${agentName}`));
  console.log(chalk.bold('\nWebhook URLs to configure in Twilio Console:'));
  console.log(`  Voice → When a call comes in:`);
  console.log(chalk.cyan(`    ${publicUrl}/voice`));
  console.log(`  SMS   → When a message comes in:`);
  console.log(chalk.cyan(`    ${publicUrl}/sms`));
  console.log(`\n  Console: https://console.twilio.com/us1/develop/phone-numbers/manage/incoming`);

  if (answers.publicUrl.includes('localhost')) {
    console.log(chalk.yellow('\n  ⚠ Localhost URLs won\'t work for Twilio webhooks.'));
    console.log('    Use ngrok to expose your local agent:');
    console.log(chalk.cyan(`    ngrok http ${port}`));
    console.log('    Then update PUBLIC_URL in your .env and re-run this command.');
  }

  console.log(`\n  Restart: ${chalk.cyan(`lobstertrap restart ${agentName}`)}\n`);
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

function getAgentPort(agentName: string): string | null {
  try {
    const stateFile = path.join(require('os').homedir(), '.lobstertrap', 'state.json');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    const agent = (state.agents || []).find((a: any) => a.name === agentName);
    return agent?.port ?? null;
  } catch {
    return null;
  }
}
