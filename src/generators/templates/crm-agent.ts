import { AgentTemplate } from './index';

export const crmAgentTemplate: AgentTemplate = {
  name: 'CRM Agent',
  description: 'Categorize customers, manage pipeline, surface insights — with Claude tool use',
  agentCode: `#!/usr/bin/env python3
"""
CRM Agent — powered by Claude
Categorizes customers, manages pipeline stages, surfaces relationship insights.

Hardened: Claude tool use enforces structured output. No JSON text parsing.
Retry logic with exponential backoff. Pydantic-style manual validation.
"""

import os
import time
import logging
from flask import Flask, request, jsonify
from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

app = Flask(__name__)
client = Anthropic()

SYSTEM_PROMPT = """You are a senior CRM analyst with deep expertise in B2B SaaS.

When categorizing customers:
- enterprise: ACV > $50k OR 500+ seats
- mid-market: ACV $10k-$50k OR 50-500 seats
- smb: ACV < $10k OR < 50 seats

Churn risk scoring (0-100):
- 0-30: healthy (active usage, on-time payments, positive NPS)
- 31-60: at risk (declining usage, support tickets, late payments)
- 61-100: churning (non-responsive, cancellation signals, missed payments)

Be data-driven. Do not guess — if data is missing, flag it in your reasoning."""


# ── Retry wrapper ──────────────────────────────────────────────────────────

def call_with_tool(messages: list, tool: dict, max_retries: int = 3) -> dict:
    for attempt in range(max_retries):
        try:
            response = client.messages.create(
                model="claude-opus-4-7",
                max_tokens=1024,
                system=SYSTEM_PROMPT,
                tools=[tool],
                tool_choice={"type": "any"},
                messages=messages,
            )
            for block in response.content:
                if block.type == "tool_use":
                    return block.input
            raise ValueError("No tool_use block returned")
        except Exception as exc:
            if attempt == max_retries - 1:
                raise
            wait = 0.5 * (2 ** attempt)
            log.warning("Attempt %d failed, retrying in %.1fs: %s", attempt + 1, wait, exc)
            time.sleep(wait)


# ── Tool schemas ──────────────────────────────────────────────────────────

CATEGORIZE_TOOL = {
    "name": "categorize_customer",
    "description": "Categorize a customer and assess their health and churn risk",
    "input_schema": {
        "type": "object",
        "properties": {
            "tier":        {"type": "string", "enum": ["enterprise", "mid-market", "smb"]},
            "health":      {"type": "string", "enum": ["healthy", "at-risk", "churning"]},
            "churn_risk":  {"type": "integer", "minimum": 0, "maximum": 100},
            "reasoning":   {"type": "string", "description": "One sentence explaining the classification"},
            "data_gaps":   {"type": "array", "items": {"type": "string"}, "description": "Missing data that would improve accuracy"},
            "recommended_actions": {
                "type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 4,
            },
        },
        "required": ["tier", "health", "churn_risk", "reasoning", "data_gaps", "recommended_actions"],
    },
}

PIPELINE_TOOL = {
    "name": "suggest_pipeline_stage",
    "description": "Assess deal data and recommend the correct pipeline stage with reasoning",
    "input_schema": {
        "type": "object",
        "properties": {
            "current_stage":     {"type": "string", "enum": ["lead", "qualified", "proposal", "negotiation", "closed-won", "closed-lost"]},
            "recommended_stage": {"type": "string", "enum": ["lead", "qualified", "proposal", "negotiation", "closed-won", "closed-lost"]},
            "confidence":        {"type": "string", "enum": ["high", "medium", "low"]},
            "reasoning":         {"type": "string"},
            "blockers":          {"type": "array", "items": {"type": "string"}},
            "next_steps":        {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 3},
        },
        "required": ["current_stage", "recommended_stage", "confidence", "reasoning", "blockers", "next_steps"],
    },
}

CHECKIN_TOOL = {
    "name": "draft_checkin",
    "description": "Draft a personalised relationship check-in message",
    "input_schema": {
        "type": "object",
        "properties": {
            "subject":   {"type": "string", "description": "Email subject line, under 60 chars"},
            "body":      {"type": "string", "description": "Message body, under 120 words, warm and specific"},
            "tone":      {"type": "string", "enum": ["warm", "professional", "urgent", "celebratory"]},
            "send_via":  {"type": "string", "enum": ["email", "slack", "linkedin"]},
        },
        "required": ["subject", "body", "tone", "send_via"],
    },
}


# ── Validation ──────────────────────────────────────────────────────────────

VALID_TIERS    = {"enterprise", "mid-market", "smb"}
VALID_HEALTH   = {"healthy", "at-risk", "churning"}
VALID_STAGES   = {"lead", "qualified", "proposal", "negotiation", "closed-won", "closed-lost"}
VALID_CONF     = {"high", "medium", "low"}

def validate_categorize(r: dict) -> dict:
    assert r["tier"]   in VALID_TIERS,  f"Invalid tier: {r['tier']}"
    assert r["health"] in VALID_HEALTH, f"Invalid health: {r['health']}"
    assert 0 <= r["churn_risk"] <= 100, f"churn_risk out of range: {r['churn_risk']}"
    assert isinstance(r["recommended_actions"], list) and r["recommended_actions"], "No actions"
    return r

def validate_pipeline(r: dict) -> dict:
    assert r["current_stage"]     in VALID_STAGES, f"Invalid current_stage"
    assert r["recommended_stage"] in VALID_STAGES, f"Invalid recommended_stage"
    assert r["confidence"]        in VALID_CONF,   f"Invalid confidence"
    assert isinstance(r["next_steps"], list) and r["next_steps"], "No next steps"
    return r

def validate_checkin(r: dict) -> dict:
    assert r.get("subject") and len(r["subject"]) <= 60, "Bad subject"
    assert r.get("body") and len(r["body"].split()) <= 130, "Body too long"
    assert r.get("tone") in {"warm", "professional", "urgent", "celebratory"}, "Bad tone"
    return r


# ── Endpoints ───────────────────────────────────────────────────────────────

@app.route("/health")
def health():
    return jsonify({"status": "healthy", "agent": "crm"})


@app.route("/categorize", methods=["POST"])
def categorize():
    """
    Categorize a customer by tier, health, and churn risk.
    Body: any JSON object with customer data (usage, ACV, NPS, support tickets, etc.)
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "Request body with customer data required"}), 400

    messages = [{"role": "user", "content": f"Categorize this customer:\\n{data}"}]

    try:
        result = call_with_tool(messages, CATEGORIZE_TOOL)
        result = validate_categorize(result)
    except AssertionError as e:
        log.error("Validation: %s", e)
        return jsonify({"error": "Validation failed", "detail": str(e)}), 500
    except Exception as e:
        log.error("Claude: %s", e)
        return jsonify({"error": "Agent unavailable"}), 503

    return jsonify(result)


@app.route("/pipeline", methods=["POST"])
def pipeline():
    """
    Recommend the correct pipeline stage for a deal.
    Body: { "deal": { ... deal fields ... } }
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "Request body required"}), 400

    messages = [{"role": "user", "content": f"Assess this deal and recommend pipeline stage:\\n{data}"}]

    try:
        result = call_with_tool(messages, PIPELINE_TOOL)
        result = validate_pipeline(result)
    except AssertionError as e:
        return jsonify({"error": "Validation failed", "detail": str(e)}), 500
    except Exception as e:
        log.error("Claude: %s", e)
        return jsonify({"error": "Agent unavailable"}), 503

    return jsonify(result)


@app.route("/checkin", methods=["POST"])
def checkin():
    """
    Draft a personalised check-in message.
    Body: { "customer_name": "...", "company": "...", "context": "..." }
    """
    data = request.get_json() or {}
    customer_name = data.get("customer_name", "")
    company       = data.get("company", "")
    context       = data.get("context", "")

    if not customer_name:
        return jsonify({"error": "customer_name required"}), 400

    prompt = f"Draft a check-in for {customer_name} at {company}. Context: {context or 'No additional context.'}"
    messages = [{"role": "user", "content": prompt}]

    try:
        result = call_with_tool(messages, CHECKIN_TOOL)
        result = validate_checkin(result)
    except AssertionError as e:
        return jsonify({"error": "Validation failed", "detail": str(e)}), 500
    except Exception as e:
        log.error("Claude: %s", e)
        return jsonify({"error": "Agent unavailable"}), 503

    return jsonify(result)


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    log.info("CRM agent running on port %d", port)
    app.run(host="0.0.0.0", port=port)
`,
};
