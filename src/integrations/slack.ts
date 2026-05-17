import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import * as fs from 'fs';
import * as path from 'path';

export async function connectSlack(agentName: string): Promise<void> {
  console.log(chalk.bold('Slack Integration Setup\n'));
  console.log('Create a Slack app at: https://api.slack.com/apps');
  console.log('Required scopes: chat:write, channels:read, im:read, im:write\n');

  const answers = await inquirer.prompt([
    {
      type: 'password',
      name: 'botToken',
      message: 'Slack Bot Token (xoxb-...):',
      validate: (v: string) => v.startsWith('xoxb-') || 'Token should start with xoxb-',
    },
    {
      type: 'password',
      name: 'appToken',
      message: 'Slack App Token (xapp-...) for Socket Mode:',
      validate: (v: string) => v.startsWith('xapp-') || 'Token should start with xapp-',
    },
  ]);

  const spinner = ora('Saving Slack credentials...').start();

  try {
    appendEnvVars(agentName, {
      SLACK_BOT_TOKEN: answers.botToken,
      SLACK_APP_TOKEN: answers.appToken,
    });
    spinner.succeed('Slack connected');
    console.log(chalk.green(`\n✓ Slack credentials saved to ${agentName}/.env`));
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
