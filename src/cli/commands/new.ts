import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import * as path from 'path';
import * as fs from 'fs';
import { generateDockerfile } from '../../generators/dockerfile-generator';
import { generateOpenClawConfig } from '../../generators/openclaw-config';
import { generateEnvFile } from '../../generators/env-generator';
import { getTemplate } from '../../generators/templates/index';
import { validateAgentName } from '../../utils/validators';
import { loadState } from './init-openclaw';

const TEMPLATES = ['Customer Service Agent', 'CRM Agent', 'Support Agent', 'Custom Agent'];
const INTEGRATIONS = ['Gmail', 'Airtable', 'Slack', 'Twilio', 'Stripe'];

export async function newAgent(_args: string[]): Promise<void> {
  console.log(chalk.cyan('\n🦞 LobsterTrap — New Agent\n'));

  const state = loadState();
  if (!state.initialized) {
    console.error(chalk.red('OpenClaw is not initialized.'));
    console.log(`  Run ${chalk.cyan('lobstertrap init-openclaw')} first.\n`);
    process.exit(1);
  }

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Agent name:',
      validate: (input: string) => {
        const err = validateAgentName(input);
        return err ?? true;
      },
    },
    {
      type: 'list',
      name: 'template',
      message: 'Template:',
      choices: TEMPLATES,
    },
    {
      type: 'checkbox',
      name: 'integrations',
      message: 'Integrations (space to select):',
      choices: INTEGRATIONS.filter((i) => i !== 'None'),
    },
    {
      type: 'input',
      name: 'port',
      message: 'Port:',
      default: '8000',
      validate: (input: string) => {
        const n = parseInt(input, 10);
        return (n >= 1024 && n <= 65535) || 'Enter a valid port between 1024 and 65535';
      },
    },
  ]);

  const agentDir = path.join(process.cwd(), answers.name);

  if (fs.existsSync(agentDir)) {
    console.error(chalk.red(`\nDirectory already exists: ${agentDir}`));
    process.exit(1);
  }

  const spinner = ora('Generating agent files...').start();

  try {
    fs.mkdirSync(agentDir, { recursive: true });

    const templateKey = answers.template.toLowerCase().replace(/ agent$/, '').replace(/\s+/g, '-');
    const template = getTemplate(templateKey);

    fs.writeFileSync(path.join(agentDir, `${templateKey}_agent.py`), template.agentCode);
    fs.writeFileSync(path.join(agentDir, 'Dockerfile'), generateDockerfile(templateKey, answers.integrations));
    fs.writeFileSync(path.join(agentDir, 'openclaw-deployment.yaml'), generateOpenClawConfig(answers.name, templateKey, answers.port));
    fs.writeFileSync(path.join(agentDir, '.env.example'), generateEnvFile(answers.integrations));
    fs.writeFileSync(path.join(agentDir, '.env'), generateEnvFile(answers.integrations));
    fs.writeFileSync(path.join(agentDir, '.gitignore'), '.env\n__pycache__/\n*.pyc\n');

    // Register agent in state
    const agents: Record<string, unknown>[] = (loadState().agents as Record<string, unknown>[]) ?? [];
    agents.push({
      name: answers.name,
      template: answers.template,
      port: answers.port,
      integrations: answers.integrations,
      status: 'created',
      createdAt: new Date().toISOString(),
      dir: agentDir,
    });
    saveAgents(agents);

    spinner.succeed('Agent files generated');
  } catch (err: any) {
    spinner.fail('Failed to generate agent files');
    throw err;
  }

  console.log(`
${chalk.green('✓ Agent created:')} ${chalk.bold(answers.name)}

  ${chalk.gray('Directory:')} ${path.join(process.cwd(), answers.name)}
  ${chalk.gray('Template:')}  ${answers.template}
  ${chalk.gray('Port:')}      ${answers.port}

${chalk.bold('Next steps:')}

  1. Edit ${chalk.cyan('.env')} with your API keys
  2. Build and deploy:
     ${chalk.cyan(`cd ${answers.name} && docker build -t ${answers.name.toLowerCase()} .`)}
  3. Check status:
     ${chalk.cyan(`lobstertrap status ${answers.name}`)}
`);
}

function saveAgents(agents: Record<string, unknown>[]): void {
  const stateFile = require('path').join(require('os').homedir(), '.lobstertrap', 'state.json');
  const state = loadState();
  fs.writeFileSync(stateFile, JSON.stringify({ ...state, agents }, null, 2));
}
