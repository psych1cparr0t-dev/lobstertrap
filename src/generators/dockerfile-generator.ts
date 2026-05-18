const INTEGRATION_DEPS: Record<string, string> = {
  Gmail:   'google-auth-oauthlib google-auth-httplib2 google-api-python-client',
  Airtable:'pyairtable',
  Slack:   'slack-sdk',
  Stripe:  'stripe',
  Twilio:  'twilio',
};

// Customer service agent uses a longer filename
const ENTRY_POINTS: Record<string, string> = {
  'customer-service': 'customer-service_agent.py',
};

export function generateDockerfile(templateKey: string, integrations: string[]): string {
  const integrationDeps = integrations
    .map((i) => INTEGRATION_DEPS[i])
    .filter(Boolean)
    .join(' ');

  const allDeps = ['anthropic', 'flask', 'python-dotenv', integrationDeps]
    .filter(Boolean)
    .join(' ');

  const entryPoint = ENTRY_POINTS[templateKey] ?? `${templateKey}_agent.py`;

  return `FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir ${allDeps}

COPY . .

EXPOSE 8000

CMD ["python", "${entryPoint}"]
`;
}

export function generateRequirementsTxt(integrations: string[]): string {
  const integrationDeps = integrations
    .map((i) => INTEGRATION_DEPS[i])
    .filter(Boolean)
    .flatMap((d) => d.split(' '));

  return ['anthropic', 'flask', 'python-dotenv', ...integrationDeps].join('\n') + '\n';
}
