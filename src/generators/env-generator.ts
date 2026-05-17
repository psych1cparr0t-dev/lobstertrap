const INTEGRATION_ENV_VARS: Record<string, string[]> = {
  Gmail: ['GMAIL_CLIENT_ID=', 'GMAIL_CLIENT_SECRET=', 'GMAIL_REFRESH_TOKEN='],
  Airtable: ['AIRTABLE_API_TOKEN=', 'AIRTABLE_BASE_ID='],
  Slack: ['SLACK_BOT_TOKEN=', 'SLACK_APP_TOKEN='],
  Stripe: ['STRIPE_SECRET_KEY=', 'STRIPE_WEBHOOK_SECRET='],
};

export function generateEnvFile(integrations: string[]): string {
  const base = [
    '# LobsterTrap Agent Environment',
    '',
    '# Anthropic',
    'ANTHROPIC_API_KEY=',
    '',
    '# Runtime',
    'PORT=8000',
    'LOG_LEVEL=INFO',
  ];

  const integrationVars = integrations.flatMap((i) => {
    const vars = INTEGRATION_ENV_VARS[i];
    if (!vars) return [];
    return ['', `# ${i}`, ...vars];
  });

  return [...base, ...integrationVars, ''].join('\n');
}
