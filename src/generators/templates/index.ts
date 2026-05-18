import { customerServiceAgentTemplate } from './customer-service-agent';
import { crmAgentTemplate } from './crm-agent';
import { supportAgentTemplate } from './support-agent';
import { customAgentTemplate } from './custom-agent';

export interface AgentTemplate {
  name: string;
  description: string;
  agentCode: string;
}

const TEMPLATES: Record<string, AgentTemplate> = {
  'customer-service': customerServiceAgentTemplate,
  crm: crmAgentTemplate,
  support: supportAgentTemplate,
  custom: customAgentTemplate,
};

export function getTemplate(key: string): AgentTemplate {
  return TEMPLATES[key] ?? customAgentTemplate;
}

export function listTemplates(): AgentTemplate[] {
  return Object.values(TEMPLATES);
}
