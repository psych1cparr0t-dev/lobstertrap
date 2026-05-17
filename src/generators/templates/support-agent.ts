import { AgentTemplate } from './index';

export const supportAgentTemplate: AgentTemplate = {
  name: 'Support Agent',
  description: 'Triage tickets, draft responses, route to the right team',
  agentCode: `#!/usr/bin/env python3
"""
Support Agent — powered by Claude
Triages tickets, drafts responses, routes to the right team.
"""

import os
import json
from flask import Flask, request, jsonify
from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
client = Anthropic()

SYSTEM_PROMPT = """You are an expert customer support specialist. Your job is to:
1. Triage support tickets by priority and category
2. Draft empathetic, accurate responses
3. Route tickets to the correct team
4. Identify patterns across multiple issues

Always be empathetic, clear, and solution-focused."""


class SupportAgent:
    def triage_ticket(self, ticket: dict) -> dict:
        prompt = f"""Triage this support ticket.

Ticket:
{json.dumps(ticket, indent=2)}

Respond with JSON:
{{
  "priority": "critical|high|medium|low",
  "category": "billing|technical|account|feature_request|other",
  "sentiment": "angry|frustrated|neutral|satisfied",
  "routed_to": "billing|engineering|success|sales|self-serve",
  "summary": "<one sentence summary>",
  "suggested_response_tone": "urgent|empathetic|informational|celebratory"
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

    def draft_response(self, ticket_body: str, context: str = "", tone: str = "empathetic") -> str:
        prompt = f"""Draft a support response for this ticket.

Customer message:
{ticket_body}

{f"Context: {context}" if context else ""}
Tone: {tone}

Write a complete, helpful response. Be empathetic and specific. Under 200 words."""

        message = client.messages.create(
            model="claude-opus-4-7",
            max_tokens=512,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )

        return message.content[0].text

    def detect_patterns(self, tickets: list) -> dict:
        prompt = f"""Analyze these support tickets and identify patterns.

Tickets:
{json.dumps(tickets, indent=2)}

Respond with JSON:
{{
  "top_issues": ["<issue1>", "<issue2>", "<issue3>"],
  "root_causes": ["<cause1>", "<cause2>"],
  "recommended_fixes": ["<fix1>", "<fix2>"],
  "knowledge_base_gaps": ["<gap1>", "<gap2>"]
}}"""

        message = client.messages.create(
            model="claude-opus-4-7",
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )

        try:
            return json.loads(message.content[0].text)
        except Exception:
            return {"error": "Could not parse response", "raw": message.content[0].text}


agent = SupportAgent()


@app.route("/health")
def health():
    return jsonify({"status": "healthy", "agent": "support"})


@app.route("/triage", methods=["POST"])
def triage():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Request body required"}), 400
    return jsonify(agent.triage_ticket(data))


@app.route("/respond", methods=["POST"])
def respond():
    data = request.get_json()
    if not data or "ticket_body" not in data:
        return jsonify({"error": "ticket_body required"}), 400
    response = agent.draft_response(
        data["ticket_body"],
        data.get("context", ""),
        data.get("tone", "empathetic"),
    )
    return jsonify({"response": response})


@app.route("/patterns", methods=["POST"])
def patterns():
    data = request.get_json()
    if not data or "tickets" not in data:
        return jsonify({"error": "tickets array required"}), 400
    return jsonify(agent.detect_patterns(data["tickets"]))


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    print(f"Support agent running on port {port}")
    app.run(host="0.0.0.0", port=port)
`,
};
