import { AgentTemplate } from './index';

export const customAgentTemplate: AgentTemplate = {
  name: 'Custom Agent',
  description: 'Blank template — build your own agent',
  agentCode: `#!/usr/bin/env python3
"""
Custom Agent — powered by Claude
Add your own logic below.
"""

import os
from flask import Flask, request, jsonify
from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
client = Anthropic()

SYSTEM_PROMPT = """You are a helpful AI agent. Customize this prompt to define your agent's role."""


class CustomAgent:
    def process(self, input_text: str) -> str:
        message = client.messages.create(
            model="claude-opus-4-7",
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": input_text}],
        )
        return message.content[0].text


agent = CustomAgent()


@app.route("/health")
def health():
    return jsonify({"status": "healthy", "agent": "custom"})


@app.route("/process", methods=["POST"])
def process():
    data = request.get_json()
    if not data or "input" not in data:
        return jsonify({"error": "input field required"}), 400
    result = agent.process(data["input"])
    return jsonify({"result": result})


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    print(f"Custom agent running on port {port}")
    app.run(host="0.0.0.0", port=port)
`,
};
