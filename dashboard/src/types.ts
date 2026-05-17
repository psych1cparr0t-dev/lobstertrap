export interface Agent {
  name: string;
  template: string;
  port: string;
  status: string;
  dockerStatus: string;
  integrations: string[];
  createdAt: string;
  lastDeployedAt?: string;
  dir: string;
}

export interface DockerMetrics {
  cpu: string;
  memory: string;
  memoryLimit: string;
  networkIn: string;
  networkOut: string;
  blockRead: string;
  blockWrite: string;
  pids: string;
}

export interface AgentMetrics {
  name: string;
  docker: DockerMetrics | null;
  agent: Record<string, unknown>;
  timestamp: string;
}

export interface LogLine {
  line: string;
  ts: string;
}
