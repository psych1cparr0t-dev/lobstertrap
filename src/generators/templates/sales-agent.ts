import { AgentTemplate } from './index';

export const salesAgentTemplate: AgentTemplate = {
  name: 'Sales Agent',
  description: 'Score leads, generate personalized emails, track follow-ups',
  agentCode: `#!/usr/bin/env python3
"""
Sales Agent — powered by Claude
Scores leads, generates personalized outreach, tracks follow-ups.
"""

import os
import json
from flask import Flask, request, jsonify
from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
client = Anthropic()

SYSTEM_PROMPT = """You are an expert sales assistant. Your job is to:
1. Score leads from 0-100 based on their profile and engagement signals
2. Write personalized, compelling outreach emails
3. Suggest optimal follow-up timing and messaging

Always be concise, data-driven, and focus on value for the prospect."""


class SalesAgent:
    def score_lead(self, lead_data: dict) -> dict:
        prompt = f"""Score this lead from 0-100 and explain why.

Lead data:
{json.dumps(lead_data, indent=2)}

Respond with JSON: {{"score": <0-100>, "reasoning": "<explanation>", "next_action": "<recommended action>"}}"""

        message = client.messages.create(
            model="claude-opus-4-7",
            max_tokens=512,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )

        try:
            return json.loads(message.content[0].text)
        except Exception:
            return {"score": 50, "reasoning": message.content[0].text, "next_action": "Manual review"}

    def generate_email(self, lead_name: str, company: str, context: str = "") -> str:
        prompt = f"""Write a personalized cold outreach email to {lead_name} at {company}.
{f"Additional context: {context}" if context else ""}

Keep it under 150 words. Be specific, not generic. Lead with value."""

        message = client.messages.create(
            model="claude-opus-4-7",
            max_tokens=512,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )

        return message.content[0].text

    def suggest_followup(self, lead_name: str, last_interaction: str, days_since: int) -> str:
        prompt = f"""Suggest a follow-up message for {lead_name}.
Last interaction: {last_interaction}
Days since last contact: {days_since}

Write a short, natural follow-up that references the previous interaction."""

        message = client.messages.create(
            model="claude-opus-4-7",
            max_tokens=256,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )

        return message.content[0].text


agent = SalesAgent()


@app.route("/health")
def health():
    return jsonify({"status": "healthy", "agent": "sales"})


@app.route("/score", methods=["POST"])
def score_lead():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Request body required"}), 400
    result = agent.score_lead(data)
    return jsonify(result)


@app.route("/email", methods=["POST"])
def generate_email():
    data = request.get_json()
    if not data or "lead_name" not in data or "company" not in data:
        return jsonify({"error": "lead_name and company required"}), 400
    email = agent.generate_email(data["lead_name"], data["company"], data.get("context", ""))
    return jsonify({"email": email})


@app.route("/followup", methods=["POST"])
def followup():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Request body required"}), 400
    message = agent.suggest_followup(
        data.get("lead_name", ""),
        data.get("last_interaction", ""),
        data.get("days_since", 7),
    )
    return jsonify({"message": message})


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    print(f"Sales agent running on port {port}")
    app.run(host="0.0.0.0", port=port)
`,
};
