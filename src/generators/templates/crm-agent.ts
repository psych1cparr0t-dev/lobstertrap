import { AgentTemplate } from './index';

export const crmAgentTemplate: AgentTemplate = {
  name: 'CRM Agent',
  description: 'Categorize customers, manage pipeline, surface insights',
  agentCode: `#!/usr/bin/env python3
"""
CRM Agent — powered by Claude
Categorizes customers, manages pipeline stages, surfaces relationship insights.
"""

import os
import json
from flask import Flask, request, jsonify
from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
client = Anthropic()

SYSTEM_PROMPT = """You are an expert CRM analyst. Your job is to:
1. Categorize customers by tier, health, and churn risk
2. Recommend pipeline stage transitions
3. Surface insights from customer interactions
4. Draft relationship-building communications

Be analytical, concise, and action-oriented."""


class CRMAgent:
    def categorize_customer(self, customer_data: dict) -> dict:
        prompt = f"""Categorize this customer and assess their health.

Customer data:
{json.dumps(customer_data, indent=2)}

Respond with JSON:
{{
  "tier": "enterprise|mid-market|smb",
  "health": "healthy|at-risk|churning",
  "churn_risk": <0-100>,
  "recommended_actions": ["<action1>", "<action2>"],
  "insights": "<key insight>"
}}"""

        message = client.messages.create(
            model="claude-opus-4-7",
            max_tokens=512,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )

        try:
            return json.loads(message.content[0].text)
        except Exception:
            return {"error": "Could not parse response", "raw": message.content[0].text}

    def suggest_pipeline_stage(self, deal_data: dict) -> dict:
        prompt = f"""Assess this deal and recommend the correct pipeline stage.

Deal data:
{json.dumps(deal_data, indent=2)}

Respond with JSON:
{{
  "current_stage": "<stage>",
  "recommended_stage": "<stage>",
  "reason": "<explanation>",
  "next_steps": ["<step1>", "<step2>"]
}}"""

        message = client.messages.create(
            model="claude-opus-4-7",
            max_tokens=512,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )

        try:
            return json.loads(message.content[0].text)
        except Exception:
            return {"error": "Could not parse response", "raw": message.content[0].text}

    def draft_check_in(self, customer_name: str, company: str, last_milestone: str) -> str:
        prompt = f"""Write a check-in message for {customer_name} at {company}.
Last milestone: {last_milestone}

Keep it warm, brief, and relationship-focused. Under 100 words."""

        message = client.messages.create(
            model="claude-opus-4-7",
            max_tokens=256,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )

        return message.content[0].text


agent = CRMAgent()


@app.route("/health")
def health():
    return jsonify({"status": "healthy", "agent": "crm"})


@app.route("/categorize", methods=["POST"])
def categorize():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Request body required"}), 400
    return jsonify(agent.categorize_customer(data))


@app.route("/pipeline", methods=["POST"])
def pipeline():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Request body required"}), 400
    return jsonify(agent.suggest_pipeline_stage(data))


@app.route("/checkin", methods=["POST"])
def checkin():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Request body required"}), 400
    message = agent.draft_check_in(
        data.get("customer_name", ""),
        data.get("company", ""),
        data.get("last_milestone", ""),
    )
    return jsonify({"message": message})


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    print(f"CRM agent running on port {port}")
    app.run(host="0.0.0.0", port=port)
`,
};
