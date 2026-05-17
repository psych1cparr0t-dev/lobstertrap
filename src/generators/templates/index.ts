import { salesAgentTemplate } from './sales-agent';
import { crmAgentTemplate } from './crm-agent';
import { supportAgentTemplate } from './support-agent';
import { customAgentTemplate } from './custom-agent';

export interface AgentTemplate {
  name: string;
  description: string;
  agentCode: string;
}

const TEMPLATES: Record<string, AgentTemplate> = {
  sales: salesAgentTemplate,
  crm: crmAgentTemplate,
  support: supportAgentTemplate,
  custom: customAgentTemplate,
};

export function getTemplate(key: string): AgentTemplate {
  const template = TEMPLATES[key];
  if (!template) {
    return customAgentTemplate;
  }
  return template;
}

export function listTemplates(): AgentTemplate[] {
  return Object.values(TEMPLATES);
}
