import chalk from 'chalk';
import { loadState } from './init-openclaw';
import { connectGmail } from '../../integrations/gmail';
import { connectAirtable } from '../../integrations/airtable';
import { connectSlack } from '../../integrations/slack';
import { connectTwilio } from '../../integrations/twilio';

const SUPPORTED = ['gmail', 'airtable', 'slack', 'twilio'];

export async function connectIntegration(args: string[]): Promise<void> {
  const [agentName, service] = args;

  if (!agentName || !service) {
    console.error(chalk.red('Usage: lobstertrap connect <agent-name> <service>'));
    console.log(`  Supported: ${SUPPORTED.join(', ')}\n`);
    process.exit(1);
  }

  const serviceLower = service.toLowerCase();
  if (!SUPPORTED.includes(serviceLower)) {
    console.error(chalk.red(`Unsupported service: ${service}`));
    console.log(`  Supported: ${SUPPORTED.join(', ')}\n`);
    process.exit(1);
  }

  const state = loadState();
  const agents = (state.agents as Record<string, unknown>[]) ?? [];
  const agent = agents.find((a) => a.name === agentName);

  if (!agent) {
    console.error(chalk.red(`Agent not found: ${agentName}`));
    process.exit(1);
  }

  console.log(chalk.cyan(`\n🦞 Connecting ${service} to ${agentName}\n`));

  switch (serviceLower) {
    case 'gmail':    await connectGmail(agentName);   break;
    case 'airtable': await connectAirtable(agentName); break;
    case 'slack':    await connectSlack(agentName);    break;
    case 'twilio':   await connectTwilio(agentName);   break;
  }
}
