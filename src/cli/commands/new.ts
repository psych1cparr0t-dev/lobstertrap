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
    console.log(`  Run ${chalk.cyan('lobstertrap setup')} first.\n`);
    process.exit(1);
  }

  // ── Name ───────────────────────────────────────────────────────────────────
  const { name } = await inquirer.prompt([{
    type: 'input',
    name: 'name',
    message: 'Agent name:',
    validate: (input: string) => validateAgentName(input) ?? true,
  }]);

  // ── Start mode ─────────────────────────────────────────────────────────────
  const { startMode } = await inquirer.prompt([{
    type: 'list',
    name: 'startMode',
    message: 'How do you want to build it?',
    choices: [
      { name: 'Pick a template  (customer service, CRM, support, or blank)', value: 'template' },
      { name: 'Describe it      (Claude designs the agent for you)',          value: 'describe' },
    ],
  }]);

  let templateKey = 'custom';
  let templateLabel = 'Custom Agent';
  let generatedSystemPrompt: string | null = null;

  if (startMode === 'template') {
    // ── Template path ────────────────────────────────────────────────────────
    const { template } = await inquirer.prompt([{
      type: 'list',
      name: 'template',
      message: 'Template:',
      choices: TEMPLATES,
    }]);
    templateLabel = template;
    templateKey = template.toLowerCase().replace(/ agent$/, '').replace(/\s+/g, '-');

  } else {
    // ── Describe path ────────────────────────────────────────────────────────
    console.log('');
    console.log(chalk.gray('  Describe what your agent should do, who it talks to, and'));
    console.log(chalk.gray('  what decisions or tasks it handles. Plain English is fine.\n'));

    const { description } = await inquirer.prompt([{
      type: 'input',
      name: 'description',
      message: 'What should this agent do?',
      validate: (v: string) => v.trim().length >= 10 || 'Please give a little more detail.',
    }]);

    const spinner = ora('Claude is designing your agent...').start();
    try {
      generatedSystemPrompt = await generateSystemPrompt(
        name,
        description,
        state.anthropicApiKey as string
      );
      spinner.succeed('Agent designed');
      console.log('');
      console.log(chalk.gray('  System prompt preview:'));
      console.log(chalk.gray('  ' + generatedSystemPrompt.slice(0, 120).replace(/\n/g, '\n  ') + (generatedSystemPrompt.length > 120 ? '...' : '')));
      console.log('');
    } catch (err: any) {
      spinner.fail('Could not generate system prompt');
      console.log(chalk.yellow('  Falling back to the Custom template — edit the system prompt in agent_config.json\n'));
    }
    templateKey = 'custom';
    templateLabel = 'Custom Agent (AI-designed)';
  }

  // ── Integrations + port ────────────────────────────────────────────────────
  const { integrations, port } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'integrations',
      message: 'Integrations (space to select):',
      choices: INTEGRATIONS,
    },
    {
      type: 'input',
      name: 'port',
      message: 'Port:',
      default: '8000',
      validate: (input: string) => {
        const n = parseInt(input, 10);
        return (n >= 1024 && n <= 65535) || 'Enter a port between 1024 and 65535';
      },
    },
  ]);

  const agentDir = path.join(process.cwd(), name);
  if (fs.existsSync(agentDir)) {
    console.error(chalk.red(`\nDirectory already exists: ${agentDir}`));
    process.exit(1);
  }

  const spinner = ora('Generating agent files...').start();

  try {
    fs.mkdirSync(agentDir, { recursive: true });

    const template = getTemplate(templateKey);
    fs.writeFileSync(path.join(agentDir, `${templateKey}_agent.py`), template.agentCode);
    fs.writeFileSync(path.join(agentDir, 'Dockerfile'), generateDockerfile(templateKey, integrations));
    fs.writeFileSync(path.join(agentDir, 'openclaw-deployment.yaml'), generateOpenClawConfig(name, templateKey, port));
    fs.writeFileSync(path.join(agentDir, '.env.example'), generateEnvFile(integrations));

    const globalKey = (loadState().anthropicApiKey as string) ?? '';
    fs.writeFileSync(path.join(agentDir, '.env'), generateEnvFile(integrations, globalKey));
    fs.writeFileSync(path.join(agentDir, '.gitignore'), '.env\nagent_config.json\n__pycache__/\n*.pyc\n');

    // Write agent_config.json — the live-editable system prompt store
    const agentConfig: Record<string, unknown> = { agent_name: name };
    if (generatedSystemPrompt) agentConfig.system_prompt = generatedSystemPrompt;
    fs.writeFileSync(
      path.join(agentDir, 'agent_config.json'),
      JSON.stringify(agentConfig, null, 2)
    );

    // Register in state
    const agents: Record<string, unknown>[] = (loadState().agents as Record<string, unknown>[]) ?? [];
    agents.push({ name, template: templateLabel, port, integrations, status: 'created', createdAt: new Date().toISOString(), dir: agentDir });
    saveAgents(agents);

    spinner.succeed('Agent files generated');
  } catch (err: any) {
    spinner.fail('Failed to generate agent files');
    throw err;
  }

  const globalKey = (loadState().anthropicApiKey as string) ?? '';
  const keyStep = globalKey
    ? chalk.green('  ✓ Anthropic API key pre-filled from setup')
    : `  1. Add your key to ${chalk.cyan(path.join(process.cwd(), name, '.env'))}`;

  const configHint = generatedSystemPrompt
    ? chalk.gray(`  ✓ System prompt generated — tweak it in agent_config.json or via the dashboard chat`)
    : '';

  console.log(`
${chalk.green('✓ Agent created:')} ${chalk.bold(name)}

  ${chalk.gray('Directory:')} ${path.join(process.cwd(), name)}
  ${chalk.gray('Template:')}  ${templateLabel}
  ${chalk.gray('Port:')}      ${port}
${configHint ? '\n' + configHint : ''}
${chalk.bold('Next steps:')}

${keyStep}
  ${globalKey ? '1' : '2'}. Deploy:
     ${chalk.cyan(`lobstertrap deploy ${name}`)}
  ${globalKey ? '2' : '3'}. Open dashboard and chat with your agent:
     ${chalk.cyan('lobstertrap dashboard')}
`);
}

async function generateSystemPrompt(
  agentName: string,
  description: string,
  apiKey: string
): Promise<string> {
  const https = require('https');
  const body = JSON.stringify({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `You are designing the system prompt for an AI agent named "${agentName}".

The operator describes the agent as:
"${description}"

Write a production-ready system prompt for this agent. The agent:
- Is a Python Flask API that handles HTTP requests
- Uses the Anthropic Claude API
- Has a /chat endpoint for natural language conversation
- May have specialised endpoints for structured tasks

Guidelines for the system prompt:
- Be specific about the agent's role, tone, and scope
- Define what it should and shouldn't do
- Give it a clear identity tied to its purpose
- Keep it under 400 words but make every word count

Return ONLY the system prompt text. No preamble, no explanation, no markdown fences.`,
    }],
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res: any) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.content?.[0]?.text ?? '');
          } catch {
            reject(new Error('Invalid response from Claude'));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

function saveAgents(agents: Record<string, unknown>[]): void {
  const stateFile = require('path').join(require('os').homedir(), '.lobstertrap', 'state.json');
  const state = loadState();
  require('fs').writeFileSync(stateFile, JSON.stringify({ ...state, agents }, null, 2));
}
