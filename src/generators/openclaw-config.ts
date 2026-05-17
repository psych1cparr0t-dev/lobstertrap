export function generateOpenClawConfig(agentName: string, templateKey: string, port: string): string {
  const imageName = agentName.toLowerCase().replace(/\s+/g, '-');
  const secretName = `${imageName}-secrets`;

  return `apiVersion: openclaw/v1
kind: Agent
metadata:
  name: ${agentName}
  labels:
    template: ${templateKey}
spec:
  image: ${imageName}:latest
  replicas: 1
  ports:
    - containerPort: ${port}
  healthCheck:
    path: /health
    initialDelaySeconds: 5
    periodSeconds: 10
  env:
    - name: PORT
      value: "${port}"
    - name: ANTHROPIC_API_KEY
      valueFrom:
        secretKeyRef:
          name: ${secretName}
          key: anthropic_api_key
`;
}
