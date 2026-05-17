export function validateAgentName(name: string): string | null {
  if (!name || name.trim().length === 0) return 'Agent name cannot be empty';
  if (name.length > 50) return 'Agent name must be 50 characters or fewer';
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) return 'Agent name can only contain letters, numbers, hyphens, and underscores';
  if (/^\d/.test(name)) return 'Agent name cannot start with a number';
  return null;
}

export function validatePort(port: string): string | null {
  const n = parseInt(port, 10);
  if (isNaN(n)) return 'Port must be a number';
  if (n < 1024 || n > 65535) return 'Port must be between 1024 and 65535';
  return null;
}

export function validateReplicas(replicas: string): string | null {
  const n = parseInt(replicas, 10);
  if (isNaN(n)) return 'Replicas must be a number';
  if (n < 1 || n > 20) return 'Replicas must be between 1 and 20';
  return null;
}
