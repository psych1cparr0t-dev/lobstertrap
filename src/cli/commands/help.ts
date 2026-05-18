import chalk from 'chalk';

export async function showHelp(_args: string[]): Promise<void> {
  console.log(`
${chalk.cyan('🦞 LobsterTrap')} ${chalk.gray('— Deploy agents to OpenClaw in 5 minutes')}

${chalk.bold('USAGE')}
  lobstertrap <command> [options]

${chalk.bold('SETUP')}
  ${chalk.cyan('init-openclaw')}              Download and configure OpenClaw locally
  ${chalk.cyan('doctor')}                     Check all dependencies and system requirements

${chalk.bold('AGENTS')}
  ${chalk.cyan('new')}                        Create a new agent from a template
  ${chalk.cyan('deploy')} <agent>             Build Docker image and start the agent
  ${chalk.cyan('list')}                       List all deployed agents
  ${chalk.cyan('status')} <agent>             Check agent health and status
  ${chalk.cyan('logs')} <agent>              Tail agent logs (-f to stream)
  ${chalk.cyan('stop')} <agent>              Stop a running agent
  ${chalk.cyan('restart')} <agent>           Gracefully restart an agent
  ${chalk.cyan('scale')} <agent> <replicas>  Scale agent replicas up or down

${chalk.bold('INTEGRATIONS')}
  ${chalk.cyan('connect')} <agent> <service>  Add an integration (gmail, airtable, slack, twilio)

${chalk.bold('MONITORING')}
  ${chalk.cyan('metrics')} <agent> [-w]       Live CPU, memory, network stats (-w to watch)
  ${chalk.cyan('dashboard')}                  Open the web dashboard in your browser

${chalk.bold('OPTIONS')}
  --help, -h                Show this help message
  --version, -v             Show version number

${chalk.bold('EXAMPLES')}
  ${chalk.gray('# Initialize OpenClaw')}
  lobstertrap init-openclaw

  ${chalk.gray('# Check your system is ready')}
  lobstertrap doctor

  ${chalk.gray('# Create and deploy a sales agent')}
  lobstertrap new
  lobstertrap deploy SalesBot

  ${chalk.gray('# View agent logs')}
  lobstertrap logs SalesBot

  ${chalk.gray('# Scale to 3 replicas')}
  lobstertrap scale SalesBot 3

  ${chalk.gray('# Connect Gmail')}
  lobstertrap connect SalesBot gmail
`);
}
