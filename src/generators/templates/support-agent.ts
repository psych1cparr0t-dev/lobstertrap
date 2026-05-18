import { AgentTemplate } from './index';

export const supportAgentTemplate: AgentTemplate = {
  name: 'Support Agent',
  description: 'Triage, route, and respond to tickets — hardened with Claude tool use',
  agentCode: `#!/usr/bin/env python3
"""
Support Agent — powered by Claude
Triages tickets, drafts responses, routes to the right team, detects patterns.

Hardened: Claude tool use enforces structured output. No JSON text parsing.
Retry logic with exponential backoff. Full output validation.
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

SYSTEM_PROMPT = """You are a senior customer support specialist and quality analyst.

Triage priorities:
- critical: data loss, security breach, full outage, cannot log in
- high: partial outage, broken core feature, billing error > $100
- medium: feature degraded, workaround exists, billing question
- low: general question, feature request, cosmetic issue

Routing rules:
- billing team: payment failures, refund requests, invoice disputes
- engineering: bugs, errors, performance issues, API problems
- success: onboarding, usage questions, expansion opportunities
- self-serve: password reset, how-to questions with docs available

When drafting responses:
- Acknowledge the emotion first, then address the issue
- Be specific — reference the exact feature or error mentioned
- Offer a concrete next step, not vague reassurances
- Never promise a timeline you can't guarantee"""


# ── Retry wrapper ────────────────────────────────────────────────────────────

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
            log.warning("Attempt %d failed, retry in %.1fs: %s", attempt + 1, wait, exc)
            time.sleep(wait)


# ── Tool schemas ─────────────────────────────────────────────────────────────

TRIAGE_TOOL = {
    "name": "triage_ticket",
    "description": "Analyse a support ticket and produce a structured triage result",
    "input_schema": {
        "type": "object",
        "properties": {
            "priority":   {"type": "string", "enum": ["critical", "high", "medium", "low"]},
            "category":   {"type": "string", "enum": ["billing", "technical", "account", "feature_request", "other"]},
            "sentiment":  {"type": "string", "enum": ["angry", "frustrated", "neutral", "satisfied"]},
            "routed_to":  {"type": "string", "enum": ["billing", "engineering", "success", "self-serve"]},
            "summary":    {"type": "string", "description": "One sentence: who has what problem"},
            "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
            "needs_human":{"type": "boolean", "description": "True if automated response is insufficient"},
        },
        "required": ["priority", "category", "sentiment", "routed_to", "summary", "confidence", "needs_human"],
    },
}

RESPOND_TOOL = {
    "name": "draft_response",
    "description": "Draft a customer-facing support response",
    "input_schema": {
        "type": "object",
        "properties": {
            "subject":          {"type": "string", "description": "Email subject line, under 60 chars"},
            "body":             {"type": "string", "description": "Full response body, empathetic and specific"},
            "tone":             {"type": "string", "enum": ["urgent", "empathetic", "informational", "apologetic"]},
            "word_count_check": {"type": "integer", "description": "Approximate word count of body"},
            "contains_apology": {"type": "boolean"},
            "next_step":        {"type": "string", "description": "The single most important action for the customer"},
        },
        "required": ["subject", "body", "tone", "word_count_check", "contains_apology", "next_step"],
    },
}

PATTERNS_TOOL = {
    "name": "detect_patterns",
    "description": "Analyse a batch of tickets and identify systemic issues",
    "input_schema": {
        "type": "object",
        "properties": {
            "top_issues": {
                "type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 5,
                "description": "Most frequent issue types, ranked by frequency",
            },
            "root_causes": {
                "type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 3,
            },
            "affected_feature": {"type": "string", "description": "Primary product area impacted"},
            "severity_distribution": {
                "type": "object",
                "properties": {
                    "critical": {"type": "integer"},
                    "high":     {"type": "integer"},
                    "medium":   {"type": "integer"},
                    "low":      {"type": "integer"},
                },
                "required": ["critical", "high", "medium", "low"],
            },
            "recommended_fixes":      {"type": "array", "items": {"type": "string"}, "minItems": 1},
            "knowledge_base_gaps":    {"type": "array", "items": {"type": "string"}},
            "escalate_to_engineering":{"type": "boolean"},
        },
        "required": [
            "top_issues", "root_causes", "affected_feature",
            "severity_distribution", "recommended_fixes",
            "knowledge_base_gaps", "escalate_to_engineering",
        ],
    },
}


# ── Validation ────────────────────────────────────────────────────────────────

VALID_PRIORITY  = {"critical", "high", "medium", "low"}
VALID_CATEGORY  = {"billing", "technical", "account", "feature_request", "other"}
VALID_SENTIMENT = {"angry", "frustrated", "neutral", "satisfied"}
VALID_ROUTED    = {"billing", "engineering", "success", "self-serve"}
VALID_CONF      = {"high", "medium", "low"}
VALID_TONE      = {"urgent", "empathetic", "informational", "apologetic"}

def validate_triage(r: dict) -> dict:
    assert r["priority"]  in VALID_PRIORITY,  f"Bad priority: {r['priority']}"
    assert r["category"]  in VALID_CATEGORY,  f"Bad category: {r['category']}"
    assert r["sentiment"] in VALID_SENTIMENT, f"Bad sentiment: {r['sentiment']}"
    assert r["routed_to"] in VALID_ROUTED,    f"Bad routed_to: {r['routed_to']}"
    assert r["confidence"]in VALID_CONF,      f"Bad confidence: {r['confidence']}"
    assert isinstance(r["needs_human"], bool), "needs_human must be bool"
    assert r.get("summary"), "summary required"
    return r

def validate_response(r: dict) -> dict:
    assert r.get("subject") and len(r["subject"]) <= 60, f"Bad subject"
    assert r.get("body") and len(r["body"]) > 20, "Body too short"
    assert r["tone"] in VALID_TONE, f"Bad tone: {r['tone']}"
    assert isinstance(r["contains_apology"], bool), "contains_apology must be bool"
    assert r.get("next_step"), "next_step required"
    return r

def validate_patterns(r: dict) -> dict:
    assert isinstance(r.get("top_issues"), list) and r["top_issues"], "top_issues required"
    assert isinstance(r.get("root_causes"), list) and r["root_causes"], "root_causes required"
    dist = r.get("severity_distribution", {})
    for k in ("critical", "high", "medium", "low"):
        assert isinstance(dist.get(k), int), f"severity_distribution.{k} must be int"
    assert isinstance(r.get("escalate_to_engineering"), bool), "escalate_to_engineering must be bool"
    return r


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.route("/health")
def health():
    return jsonify({"status": "healthy", "agent": "support"})


@app.route("/triage", methods=["POST"])
def triage():
    """
    Triage a support ticket.
    Body: { "subject": "...", "body": "...", "customer_tier": "pro" }
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "Request body required"}), 400

    messages = [{"role": "user", "content": f"Triage this ticket:\\n{data}"}]

    try:
        result = call_with_tool(messages, TRIAGE_TOOL)
        result = validate_triage(result)
    except AssertionError as e:
        log.error("Validation: %s", e)
        return jsonify({"error": "Validation failed", "detail": str(e)}), 500
    except Exception as e:
        log.error("Claude: %s", e)
        return jsonify({"error": "Agent unavailable"}), 503

    return jsonify(result)


@app.route("/respond", methods=["POST"])
def respond():
    """
    Draft a support response.
    Body: { "ticket_body": "...", "tone": "empathetic", "context": "Pro customer, 2-year account" }
    """
    data = request.get_json()
    if not data or not data.get("ticket_body"):
        return jsonify({"error": "ticket_body required"}), 400

    prompt = (
        f"Draft a support response for this ticket.\\n"
        f"Ticket: {data['ticket_body']}\\n"
        f"Tone requested: {data.get('tone', 'empathetic')}\\n"
        f"Context: {data.get('context', 'Standard customer')}"
    )
    messages = [{"role": "user", "content": prompt}]

    try:
        result = call_with_tool(messages, RESPOND_TOOL)
        result = validate_response(result)
    except AssertionError as e:
        return jsonify({"error": "Validation failed", "detail": str(e)}), 500
    except Exception as e:
        log.error("Claude: %s", e)
        return jsonify({"error": "Agent unavailable"}), 503

    return jsonify(result)


@app.route("/patterns", methods=["POST"])
def patterns():
    """
    Detect systemic patterns across multiple tickets.
    Body: { "tickets": [ { "subject": "...", "body": "..." }, ... ] }
    """
    data = request.get_json()
    if not data or not isinstance(data.get("tickets"), list) or not data["tickets"]:
        return jsonify({"error": "tickets array required"}), 400
    if len(data["tickets"]) > 100:
        return jsonify({"error": "Maximum 100 tickets per request"}), 400

    messages = [{"role": "user", "content": f"Detect patterns in these {len(data['tickets'])} tickets:\\n{data['tickets']}"}]

    try:
        result = call_with_tool(messages, PATTERNS_TOOL)
        result = validate_patterns(result)
    except AssertionError as e:
        return jsonify({"error": "Validation failed", "detail": str(e)}), 500
    except Exception as e:
        log.error("Claude: %s", e)
        return jsonify({"error": "Agent unavailable"}), 503

    return jsonify(result)


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    log.info("Support agent running on port %d", port)
    app.run(host="0.0.0.0", port=port)
`,
};
