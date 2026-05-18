const INTEGRATION_ENV_VARS: Record<string, string[]> = {
  Gmail:   ['GMAIL_CLIENT_ID=', 'GMAIL_CLIENT_SECRET=', 'GMAIL_REFRESH_TOKEN='],
  Airtable:['AIRTABLE_API_TOKEN=', 'AIRTABLE_BASE_ID='],
  Slack:   ['SLACK_BOT_TOKEN=', 'SLACK_APP_TOKEN='],
  Stripe:  ['STRIPE_SECRET_KEY=', 'STRIPE_WEBHOOK_SECRET='],
  Twilio:  ['TWILIO_ACCOUNT_SID=', 'TWILIO_AUTH_TOKEN=', 'TWILIO_PHONE_NUMBER=', 'PUBLIC_URL=', 'ESCALATION_PHONE_NUMBER='],
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
