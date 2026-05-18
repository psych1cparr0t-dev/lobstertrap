import { AgentTemplate } from './index';

export const supportAgentTemplate: AgentTemplate = {
  name: 'Support Agent',
  description: 'Triage, route, and respond to tickets — hardened with Claude tool use',
  agentCode: `#!/usr/bin/env python3
"""
================================================================================
Support Agent — powered by Claude (claude-sonnet-4-6)
================================================================================
What this agent does:
  Triages inbound support tickets with priority and routing, drafts empathetic
  customer responses, detects systemic patterns across ticket batches, answers
  support strategy questions in natural language, and posts Slack notifications
  to your team channels.

Environment variables:
  Required:
    ANTHROPIC_API_KEY     — Anthropic API key

  Optional (agent starts without these; integrations are disabled with a warning):
    SLACK_BOT_TOKEN       — Slack Bot OAuth token (xoxb-...)
    SLACK_DEFAULT_CHANNEL — Default Slack channel ID or name (e.g. #support-alerts)

Endpoints:
  GET  /health
    Returns agent health status.
    curl http://localhost:8000/health

  POST /triage
    Triage a support ticket: priority, category, sentiment, routing.
    curl -X POST http://localhost:8000/triage \\
         -H 'Content-Type: application/json' \\
         -d '{"subject": "Cannot log in", "body": "Getting 500 error since this morning", "customer_tier": "enterprise"}'

  POST /respond
    Draft a support response for a ticket.
    curl -X POST http://localhost:8000/respond \\
         -H 'Content-Type: application/json' \\
         -d '{"ticket_body": "I was charged twice this month!", "tone": "apologetic", "context": "Pro plan, 3-year customer"}'

  POST /patterns
    Analyze up to 50 tickets for systemic patterns and escalation signals.
    curl -X POST http://localhost:8000/patterns \\
         -H 'Content-Type: application/json' \\
         -d '{"tickets": [{"subject": "Login broken", "body": "..."}, {"subject": "500 error", "body": "..."}]}'

  POST /chat
    Natural language conversation — ask about common issues, draft responses, get advice.
    curl -X POST http://localhost:8000/chat \\
         -H 'Content-Type: application/json' \\
         -d '{"message": "Draft a response for an angry enterprise customer about a billing overcharge", "session_id": "agent-1"}'

  POST /notify
    Post a message to a Slack channel. Requires SLACK_BOT_TOKEN.
    curl -X POST http://localhost:8000/notify \\
         -H 'Content-Type: application/json' \\
         -d '{"text": "Critical ticket #4821 needs immediate attention", "channel": "#support-alerts"}'
================================================================================
"""

import os
import json
import time
import logging
from flask import Flask, request, jsonify
from anthropic import Anthropic
from dotenv import load_dotenv
from collections import defaultdict

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

app = Flask(__name__)
client = Anthropic()

# ── Optional Slack integration ───────────────────────────────────────────────

SLACK_BOT_TOKEN       = os.getenv("SLACK_BOT_TOKEN")
SLACK_DEFAULT_CHANNEL = os.getenv("SLACK_DEFAULT_CHANNEL", "#support-alerts")
slack_client = None

if SLACK_BOT_TOKEN:
    try:
        from slack_sdk import WebClient as SlackWebClient
        slack_client = SlackWebClient(token=SLACK_BOT_TOKEN)
        log.info("Slack integration enabled (default channel: %s)", SLACK_DEFAULT_CHANNEL)
    except ImportError:
        log.warning("slack_sdk not installed — Slack integration disabled. Run: pip install slack_sdk")
    except Exception as exc:
        log.warning("Slack init failed — integration disabled: %s", exc)
else:
    log.warning("SLACK_BOT_TOKEN not set — /notify endpoint will return 503")

# ── Per-session chat history (max 20 turns = 40 messages) ────────────────────

_chat_histories: dict = defaultdict(list)
MAX_TURNS = 20

# ── Hot-reloadable system prompt ─────────────────────────────────────────────

CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "agent_config.json")

DEFAULT_SYSTEM_PROMPT = """You are a senior customer support specialist and quality analyst with deep expertise in B2B SaaS support operations.

TRIAGE PRIORITY DEFINITIONS:
  critical — Data loss, security breach, full product outage, complete login failure
  high     — Partial outage, core feature broken with no workaround, billing error > $100
  medium   — Feature degraded but workaround exists, billing question, account access issue
  low      — General how-to question, feature request, cosmetic issue, documentation gap

ROUTING RULES:
  engineering  — Bugs, error messages, API failures, performance degradation, data integrity issues
  billing      — Payment failures, overcharges, refund requests, invoice disputes, subscription changes
  success      — Onboarding, usage questions, expansion opportunities, QBR requests, training needs
  tier1        — Password resets, basic how-to questions with existing documentation, simple account lookups

CATEGORY DEFINITIONS:
  bug              — Something that worked before is now broken
  billing          — Payment, invoice, or subscription related
  feature_request  — Request for new functionality
  account          — Login, permissions, user management
  general          — Everything else

SENTIMENT SIGNALS:
  frustrated — Exclamation marks, words like "again", "still", "always broken", multiple follow-ups
  neutral    — Matter-of-fact description, no emotional language
  satisfied  — "Thanks", "great product", asking for help to do more with the product

RESPONSE DRAFTING PRINCIPLES:
  1. Acknowledge the emotion before addressing the technical issue
  2. Reference the specific feature or error they mentioned — never be generic
  3. Provide a concrete next step, not vague reassurances like "we'll look into it"
  4. Never promise a specific resolution timeline unless you can guarantee it
  5. Keep responses under 150 words — clarity beats length
  6. If the customer is enterprise-tier, offer to escalate to their CSM

PATTERN ANALYSIS:
  - Look for recurring error codes, feature names, or workflows across tickets
  - Severity distribution should reflect actual ticket counts, not estimations
  - Escalate to engineering when > 3 tickets share a root cause suggesting a product bug
  - Flag knowledge base gaps when customers ask about documented features incorrectly"""

def load_system_prompt() -> str:
    try:
        with open(CONFIG_FILE) as f:
            return json.load(f).get("system_prompt", DEFAULT_SYSTEM_PROMPT)
    except (FileNotFoundError, json.JSONDecodeError):
        return DEFAULT_SYSTEM_PROMPT

def save_system_prompt(prompt: str) -> None:
    config: dict = {}
    try:
        with open(CONFIG_FILE) as f:
            config = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        pass
    config["system_prompt"] = prompt
    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=2)

# ── Retry wrapper ────────────────────────────────────────────────────────────

def call_with_tool(messages: list, tool: dict, max_retries: int = 3) -> dict:
    for attempt in range(max_retries):
        try:
            response = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=1024,
                system=load_system_prompt(),
                tools=[tool],
                tool_choice={"type": "any"},
                messages=messages,
            )
            for block in response.content:
                if block.type == "tool_use":
                    return block.input
            raise ValueError("No tool_use block in response")
        except Exception as exc:
            if attempt == max_retries - 1:
                raise
            wait = 0.5 * (2 ** attempt)
            log.warning("Attempt %d failed, retry in %.1fs: %s", attempt + 1, wait, exc)
            time.sleep(wait)

# ── Tool schemas ─────────────────────────────────────────────────────────────

TRIAGE_TOOL = {
    "name": "triage_ticket",
    "description": "Analyse a support ticket and produce a structured triage result with routing and priority",
    "input_schema": {
        "type": "object",
        "properties": {
            "priority": {
                "type": "string",
                "enum": ["critical", "high", "medium", "low"],
            },
            "category": {
                "type": "string",
                "enum": ["bug", "billing", "feature_request", "account", "general"],
            },
            "sentiment": {
                "type": "string",
                "enum": ["frustrated", "neutral", "satisfied"],
            },
            "routed_to": {
                "type": "string",
                "enum": ["engineering", "billing", "success", "tier1"],
            },
            "needs_human": {
                "type": "boolean",
                "description": "True if automated response is insufficient and a human must respond",
            },
            "summary": {
                "type": "string",
                "description": "One sentence: who is affected and what the problem is",
            },
            "confidence": {
                "type": "string",
                "enum": ["high", "medium", "low"],
                "description": "Confidence in this triage based on available information",
            },
        },
        "required": ["priority", "category", "sentiment", "routed_to", "needs_human", "summary", "confidence"],
    },
}

RESPOND_TOOL = {
    "name": "draft_response",
    "description": "Draft a customer-facing support response that is empathetic, specific, and actionable",
    "input_schema": {
        "type": "object",
        "properties": {
            "subject": {
                "type": "string",
                "description": "Email subject line, maximum 60 characters",
            },
            "body": {
                "type": "string",
                "description": "Full response body — empathetic opening, specific solution, clear next step. Max 150 words.",
            },
            "word_count_check": {
                "type": "integer",
                "description": "Actual word count of the body field — enforced to be <= 150",
            },
            "contains_apology": {
                "type": "boolean",
                "description": "True if the response includes an explicit apology",
            },
            "next_step": {
                "type": "string",
                "description": "The single most important action for the customer to take",
            },
            "tone": {
                "type": "string",
                "enum": ["urgent", "empathetic", "informational", "apologetic"],
            },
        },
        "required": ["subject", "body", "word_count_check", "contains_apology", "next_step", "tone"],
    },
}

PATTERNS_TOOL = {
    "name": "detect_patterns",
    "description": "Analyse a batch of support tickets and identify systemic issues, root causes, and escalation needs",
    "input_schema": {
        "type": "object",
        "properties": {
            "top_issues": {
                "type": "array",
                "items": {"type": "string"},
                "minItems": 1,
                "description": "Most frequent issue types, ranked by frequency (max 5)",
            },
            "severity_distribution": {
                "type": "object",
                "properties": {
                    "critical": {"type": "integer"},
                    "high":     {"type": "integer"},
                    "medium":   {"type": "integer"},
                    "low":      {"type": "integer"},
                },
                "required": ["critical", "high", "medium", "low"],
                "description": "Count of tickets per severity level",
            },
            "escalate_to_engineering": {
                "type": "boolean",
                "description": "True if patterns suggest a product bug requiring engineering intervention",
            },
            "root_causes": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Underlying causes driving the observed patterns",
            },
            "knowledge_base_gaps": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Topics customers ask about that lack adequate documentation",
            },
            "recommended_actions": {
                "type": "array",
                "items": {"type": "string"},
                "minItems": 1,
                "description": "Prioritised actions to address the identified patterns",
            },
        },
        "required": [
            "top_issues", "severity_distribution", "escalate_to_engineering",
            "root_causes", "knowledge_base_gaps", "recommended_actions",
        ],
    },
}

# ── Validation helpers ───────────────────────────────────────────────────────

VALID_PRIORITY  = {"critical", "high", "medium", "low"}
VALID_CATEGORY  = {"bug", "billing", "feature_request", "account", "general"}
VALID_SENTIMENT = {"frustrated", "neutral", "satisfied"}
VALID_ROUTED    = {"engineering", "billing", "success", "tier1"}
VALID_CONF      = {"high", "medium", "low"}
VALID_TONE      = {"urgent", "empathetic", "informational", "apologetic"}

def validate_triage(r: dict) -> dict:
    assert r.get("priority")  in VALID_PRIORITY,  f"Invalid priority: {r.get('priority')}"
    assert r.get("category")  in VALID_CATEGORY,  f"Invalid category: {r.get('category')}"
    assert r.get("sentiment") in VALID_SENTIMENT, f"Invalid sentiment: {r.get('sentiment')}"
    assert r.get("routed_to") in VALID_ROUTED,    f"Invalid routed_to: {r.get('routed_to')}"
    assert r.get("confidence") in VALID_CONF,     f"Invalid confidence: {r.get('confidence')}"
    assert isinstance(r.get("needs_human"), bool), "needs_human must be a boolean"
    assert r.get("summary"), "summary is required"
    return r

def validate_response(r: dict) -> dict:
    assert r.get("subject") and len(r["subject"]) <= 60, f"subject missing or too long ({len(r.get('subject', ''))} chars)"
    word_count = len(r.get("body", "").split())
    assert word_count <= 150, f"body too long ({word_count} words; max 150)"
    assert r.get("tone") in VALID_TONE, f"Invalid tone: {r.get('tone')}"
    assert isinstance(r.get("contains_apology"), bool), "contains_apology must be a boolean"
    assert r.get("next_step"), "next_step is required"
    return r

def validate_patterns(r: dict) -> dict:
    assert isinstance(r.get("top_issues"), list) and r["top_issues"], "top_issues must be a non-empty list"
    dist = r.get("severity_distribution", {})
    for level in ("critical", "high", "medium", "low"):
        assert isinstance(dist.get(level), int), f"severity_distribution.{level} must be an integer"
    assert isinstance(r.get("escalate_to_engineering"), bool), "escalate_to_engineering must be a boolean"
    assert isinstance(r.get("root_causes"), list), "root_causes must be a list"
    assert isinstance(r.get("recommended_actions"), list) and r["recommended_actions"], "recommended_actions required"
    return r

# ── Endpoints ────────────────────────────────────────────────────────────────

@app.route("/health")
def health():
    return jsonify({"status": "healthy", "agent": "support", "version": "1.0.0"})


@app.route("/triage", methods=["POST"])
def triage():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Request body with ticket data required"}), 400

    messages = [{"role": "user", "content": f"Triage this support ticket:\\n{data}"}]

    try:
        result = call_with_tool(messages, TRIAGE_TOOL)
        result = validate_triage(result)
    except AssertionError as exc:
        log.error("Validation error: %s", exc)
        return jsonify({"error": "Validation failed", "detail": str(exc)}), 500
    except Exception as exc:
        log.error("Claude call failed: %s", exc)
        return jsonify({"error": "Agent unavailable"}), 503

    return jsonify(result)


@app.route("/respond", methods=["POST"])
def respond():
    data = request.get_json()
    if not data or not data.get("ticket_body"):
        return jsonify({"error": "ticket_body is required"}), 400

    prompt = (
        f"Draft a support response for this ticket.\\n"
        f"Ticket: {data['ticket_body']}\\n"
        f"Requested tone: {data.get('tone', 'empathetic')}\\n"
        f"Customer context: {data.get('context', 'Standard customer, no additional context.')}"
    )
    messages = [{"role": "user", "content": prompt}]

    try:
        result = call_with_tool(messages, RESPOND_TOOL)
        result = validate_response(result)
    except AssertionError as exc:
        log.error("Validation error: %s", exc)
        return jsonify({"error": "Validation failed", "detail": str(exc)}), 500
    except Exception as exc:
        log.error("Claude call failed: %s", exc)
        return jsonify({"error": "Agent unavailable"}), 503

    return jsonify(result)


@app.route("/patterns", methods=["POST"])
def patterns():
    data = request.get_json()
    if not data or not isinstance(data.get("tickets"), list) or not data["tickets"]:
        return jsonify({"error": "tickets must be a non-empty array"}), 400
    if len(data["tickets"]) > 50:
        return jsonify({"error": "Maximum 50 tickets per request"}), 400

    ticket_count = len(data["tickets"])
    messages = [{
        "role": "user",
        "content": f"Analyse these {ticket_count} support tickets and identify systemic patterns:\\n{data['tickets']}",
    }]

    try:
        result = call_with_tool(messages, PATTERNS_TOOL)
        result = validate_patterns(result)
    except AssertionError as exc:
        log.error("Validation error: %s", exc)
        return jsonify({"error": "Validation failed", "detail": str(exc)}), 500
    except Exception as exc:
        log.error("Claude call failed: %s", exc)
        return jsonify({"error": "Agent unavailable"}), 503

    return jsonify(result)


@app.route("/chat", methods=["POST"])
def chat():
    data = request.get_json() or {}
    message    = (data.get("message") or "").strip()
    session_id = (data.get("session_id") or "default").strip()

    if not message:
        return jsonify({"error": "message is required"}), 400

    history = _chat_histories[session_id]
    history.append({"role": "user", "content": message})

    # Keep history bounded to MAX_TURNS turns (each turn = 2 messages)
    if len(history) > MAX_TURNS * 2:
        history[:] = history[-(MAX_TURNS * 2):]

    try:
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=history,
        )
        reply = response.content[0].text
    except Exception as exc:
        log.error("Claude chat failed: %s", exc)
        return jsonify({"error": "Agent unavailable"}), 503

    history.append({"role": "assistant", "content": reply})
    return jsonify({"reply": reply, "session_id": session_id})


@app.route("/notify", methods=["POST"])
def notify():
    if slack_client is None:
        return jsonify({"error": "Slack integration not configured. Set SLACK_BOT_TOKEN."}), 503

    data = request.get_json() or {}
    text    = (data.get("text") or "").strip()
    channel = (data.get("channel") or SLACK_DEFAULT_CHANNEL).strip()

    if not text:
        return jsonify({"error": "text is required"}), 400
    if not channel:
        return jsonify({"error": "channel is required (or set SLACK_DEFAULT_CHANNEL)"}), 400

    try:
        response = slack_client.chat_postMessage(channel=channel, text=text)
    except Exception as exc:
        log.error("Slack postMessage failed: %s", exc)
        return jsonify({"error": "Failed to post Slack message", "detail": str(exc)}), 502

    return jsonify({
        "ok": True,
        "channel": response.get("channel"),
        "ts": response.get("ts"),
    })


@app.route("/configure", methods=["POST"])
def configure():
    """Hot-reload the system prompt. Accepts a plain-English instruction."""
    data = request.get_json(silent=True) or {}
    instruction = str(data.get("instruction", "")).strip()
    if not instruction:
        return jsonify({"error": "instruction field required"}), 400
    current = load_system_prompt()
    try:
        resp = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            messages=[{"role": "user", "content": (
                f"Current system prompt:\\n{current}\\n\\nInstruction: {instruction}\\n\\n"
                "Rewrite the system prompt to incorporate this instruction. "
                "Return ONLY the updated system prompt, no explanation."
            )}],
        )
        new_prompt = resp.content[0].text.strip()
    except Exception as exc:
        log.error("Configure failed: %s", exc)
        return jsonify({"error": "Could not update system prompt"}), 503
    save_system_prompt(new_prompt)
    log.info("System prompt updated via /configure")
    return jsonify({"ok": True, "system_prompt": new_prompt})


if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    log.info("Support agent running on port %d", port)
    app.run(host="0.0.0.0", port=port)
`,
};
