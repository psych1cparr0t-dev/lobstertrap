const INTEGRATION_DEPS: Record<string, string> = {
  Gmail: 'google-auth-oauthlib google-auth-httplib2 google-api-python-client',
  Airtable: 'pyairtable',
  Slack: 'slack-sdk',
  Stripe: 'stripe',
};

export function generateDockerfile(templateKey: string, integrations: string[]): string {
  const integrationDeps = integrations
    .map((i) => INTEGRATION_DEPS[i])
    .filter(Boolean)
    .join(' ');

  const allDeps = ['anthropic', 'flask', 'python-dotenv', integrationDeps].filter(Boolean).join(' ');

  return `FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt* ./
RUN pip install --no-cache-dir ${allDeps}

COPY . .

EXPOSE 8000

CMD ["python", "${templateKey}_agent.py"]
`;
}

export function generateRequirementsTxt(integrations: string[]): string {
  const integrationDeps = integrations
    .map((i) => INTEGRATION_DEPS[i])
    .filter(Boolean)
    .flatMap((d) => d.split(' '));

  const deps = ['anthropic', 'flask', 'python-dotenv', ...integrationDeps];
  return deps.join('\n') + '\n';
}
