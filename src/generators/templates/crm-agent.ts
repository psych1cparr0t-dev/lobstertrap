import { AgentTemplate } from './index';

export const crmAgentTemplate: AgentTemplate = {
  name: 'CRM Agent',
  description: 'Categorize customers, manage pipeline, surface insights — with Claude tool use',
  agentCode: `#!/usr/bin/env python3
"""
================================================================================
CRM Agent — powered by Claude (claude-sonnet-4-6)
================================================================================
What this agent does:
  Classifies customers by tier and churn risk, recommends pipeline stage
  transitions, drafts personalised check-in emails, answers CRM strategy
  questions in natural language, and syncs customer records from Airtable.

Environment variables:
  Required:
    ANTHROPIC_API_KEY     — Anthropic API key

  Optional (agent starts without these; integrations are disabled with a warning):
    AIRTABLE_TOKEN        — Airtable personal access token
    AIRTABLE_BASE_ID      — Airtable base ID (e.g. appXXXXXXXXXXXXXX)

Endpoints:
  GET  /health
    Returns agent health status.
    curl http://localhost:8000/health

  POST /categorize
    Classify a customer by tier, churn risk, and data gaps.
    curl -X POST http://localhost:8000/categorize \\
         -H 'Content-Type: application/json' \\
         -d '{"company": "Acme Corp", "acv": 75000, "seats": 600, "nps": 45, "open_tickets": 3}'

  POST /pipeline
    Recommend the next pipeline stage for a deal.
    curl -X POST http://localhost:8000/pipeline \\
         -H 'Content-Type: application/json' \\
         -d '{"deal_name": "Acme Expansion", "current_stage": "demo", "days_in_stage": 14, "champion": true}'

  POST /checkin
    Draft a personalised check-in email for a customer.
    curl -X POST http://localhost:8000/checkin \\
         -H 'Content-Type: application/json' \\
         -d '{"customer_name": "Jane Smith", "company": "Acme Corp", "context": "QBR coming up next month"}'

  POST /chat
    Natural language conversation about CRM strategy, customer health, pipeline.
    curl -X POST http://localhost:8000/chat \\
         -H 'Content-Type: application/json' \\
         -d '{"message": "Which customers are most at risk of churning?", "session_id": "user-123"}'

  POST /sync
    Read and enrich a customer record from Airtable. Requires AIRTABLE_TOKEN and AIRTABLE_BASE_ID.
    curl -X POST http://localhost:8000/sync \\
         -H 'Content-Type: application/json' \\
         -d '{"record_id": "recXXXXXXXXXXXXXX"}'
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

# ── Optional Airtable integration ────────────────────────────────────────────

AIRTABLE_TOKEN   = os.getenv("AIRTABLE_TOKEN")
AIRTABLE_BASE_ID = os.getenv("AIRTABLE_BASE_ID")
airtable_customers = None

if AIRTABLE_TOKEN and AIRTABLE_BASE_ID:
    try:
        from pyairtable import Api as AirtableApi
        airtable_customers = AirtableApi(AIRTABLE_TOKEN).table(AIRTABLE_BASE_ID, "Customers")
        log.info("Airtable integration enabled (base: %s)", AIRTABLE_BASE_ID)
    except ImportError:
        log.warning("pyairtable not installed — Airtable integration disabled. Run: pip install pyairtable")
    except Exception as exc:
        log.warning("Airtable init failed — integration disabled: %s", exc)
else:
    log.warning("AIRTABLE_TOKEN or AIRTABLE_BASE_ID not set — /sync endpoint will return 503")

# ── Per-session chat history (max 20 turns = 40 messages) ────────────────────

_chat_histories: dict = defaultdict(list)
MAX_TURNS = 20

# ── Hot-reloadable system prompt ─────────────────────────────────────────────

CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "agent_config.json")

DEFAULT_SYSTEM_PROMPT = """You are a senior CRM strategist and customer success expert with 15+ years in B2B SaaS.

CUSTOMER TIER DEFINITIONS:
  enterprise  — ACV > $50k OR 500+ seats OR Fortune 1000
  mid-market  — ACV $10k–$50k OR 50–500 seats
  smb         — ACV < $10k OR < 50 seats
  prospect    — No active contract; in evaluation or pre-sale

CHURN RISK SCORING (0–100):
  0–30  Healthy   — active usage, on-time payments, positive NPS (>40), engaged champion
  31–60 At Risk   — declining usage, multiple support tickets, late payments, NPS 10–40
  61–100 Churning — non-responsive, cancellation signals, missed payments, NPS < 10, no champion

PIPELINE STAGE DEFINITIONS:
  discovery    — Needs identified, but not yet qualified
  demo         — Product demonstrated; evaluating fit
  proposal     — Commercial terms sent; awaiting decision
  negotiation  — Legal/procurement engaged; close imminent
  closed_won   — Contract signed
  closed_lost  — Opportunity ended without purchase

ANALYSIS PRINCIPLES:
  - Be data-driven. Flag missing data explicitly in data_gaps.
  - Do not fabricate metrics. If a field is absent, note it.
  - Prioritise customer outcomes over vanity metrics.
  - Churn risk must be grounded in observable signals, not gut feel.
  - Pipeline confidence reflects both deal quality and information quality.

When answering conversational questions:
  - Provide specific, actionable advice rather than generic best practices.
  - Cite the relevant signals from any customer data provided.
  - If asked to compare customers, structure your analysis clearly.
  - Proactively surface risks the user may not have asked about."""

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
            log.warning("Attempt %d failed, retrying in %.1fs: %s", attempt + 1, wait, exc)
            time.sleep(wait)

# ── Tool schemas ─────────────────────────────────────────────────────────────

CATEGORIZE_TOOL = {
    "name": "categorize_customer",
    "description": "Classify a customer by tier, churn risk score, and surface data gaps",
    "input_schema": {
        "type": "object",
        "properties": {
            "tier": {
                "type": "string",
                "enum": ["enterprise", "mid-market", "smb", "prospect"],
                "description": "Customer size tier",
            },
            "churn_risk": {
                "type": "integer",
                "minimum": 0,
                "maximum": 100,
                "description": "Churn risk score from 0 (healthy) to 100 (churning)",
            },
            "health": {
                "type": "string",
                "enum": ["healthy", "at-risk", "churning"],
                "description": "Derived health label from churn_risk",
            },
            "reasoning": {
                "type": "string",
                "description": "One to two sentences explaining the classification with specific signals",
            },
            "data_gaps": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Fields missing from the input that would materially improve accuracy",
            },
            "recommended_actions": {
                "type": "array",
                "items": {"type": "string"},
                "minItems": 1,
                "maxItems": 4,
                "description": "Prioritised next actions for the CSM or AE",
            },
        },
        "required": ["tier", "churn_risk", "health", "reasoning", "data_gaps", "recommended_actions"],
    },
}

PIPELINE_TOOL = {
    "name": "suggest_pipeline_stage",
    "description": "Assess deal data and recommend the correct pipeline stage with confidence and blockers",
    "input_schema": {
        "type": "object",
        "properties": {
            "stage": {
                "type": "string",
                "enum": ["discovery", "demo", "proposal", "negotiation", "closed_won", "closed_lost"],
                "description": "Recommended pipeline stage",
            },
            "confidence": {
                "type": "integer",
                "minimum": 0,
                "maximum": 100,
                "description": "Confidence in the stage recommendation (0–100)",
            },
            "blockers": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Current obstacles preventing stage advancement",
            },
            "next_steps": {
                "type": "array",
                "items": {"type": "string"},
                "minItems": 1,
                "maxItems": 3,
                "description": "Concrete actions to advance the deal",
            },
            "reasoning": {
                "type": "string",
                "description": "Brief explanation of why this stage was recommended",
            },
        },
        "required": ["stage", "confidence", "blockers", "next_steps", "reasoning"],
    },
}

CHECKIN_TOOL = {
    "name": "draft_checkin_email",
    "description": "Draft a personalised, warm check-in email for a customer relationship",
    "input_schema": {
        "type": "object",
        "properties": {
            "subject": {
                "type": "string",
                "description": "Email subject line, maximum 60 characters",
            },
            "body": {
                "type": "string",
                "description": "Email body, maximum 120 words, warm, specific, and actionable",
            },
            "tone": {
                "type": "string",
                "enum": ["warm", "professional", "urgent", "celebratory"],
            },
            "suggested_send_time": {
                "type": "string",
                "description": "e.g. 'Tuesday morning' or 'End of quarter'",
            },
        },
        "required": ["subject", "body", "tone", "suggested_send_time"],
    },
}

# ── Validation helpers ───────────────────────────────────────────────────────

VALID_TIERS   = {"enterprise", "mid-market", "smb", "prospect"}
VALID_HEALTH  = {"healthy", "at-risk", "churning"}
VALID_STAGES  = {"discovery", "demo", "proposal", "negotiation", "closed_won", "closed_lost"}

def validate_categorize(r: dict) -> dict:
    assert r.get("tier") in VALID_TIERS, f"Invalid tier: {r.get('tier')}"
    assert r.get("health") in VALID_HEALTH, f"Invalid health: {r.get('health')}"
    assert isinstance(r.get("churn_risk"), int) and 0 <= r["churn_risk"] <= 100, "churn_risk out of range"
    assert isinstance(r.get("recommended_actions"), list) and r["recommended_actions"], "recommended_actions required"
    assert isinstance(r.get("data_gaps"), list), "data_gaps must be a list"
    return r

def validate_pipeline(r: dict) -> dict:
    assert r.get("stage") in VALID_STAGES, f"Invalid stage: {r.get('stage')}"
    assert isinstance(r.get("confidence"), int) and 0 <= r["confidence"] <= 100, "confidence out of range"
    assert isinstance(r.get("blockers"), list), "blockers must be a list"
    assert isinstance(r.get("next_steps"), list) and r["next_steps"], "next_steps required"
    return r

def validate_checkin(r: dict) -> dict:
    assert r.get("subject") and len(r["subject"]) <= 60, f"subject missing or too long ({len(r.get('subject',''))} chars)"
    body_words = len(r.get("body", "").split())
    assert body_words <= 120, f"body too long ({body_words} words; max 120)"
    assert r.get("tone") in {"warm", "professional", "urgent", "celebratory"}, f"Invalid tone: {r.get('tone')}"
    return r

# ── Endpoints ────────────────────────────────────────────────────────────────

@app.route("/health")
def health():
    return jsonify({"status": "healthy", "agent": "crm", "version": "1.0.0"})


@app.route("/categorize", methods=["POST"])
def categorize():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Request body with customer data required"}), 400

    messages = [{"role": "user", "content": f"Categorize this customer and assess their health:\\n{data}"}]

    try:
        result = call_with_tool(messages, CATEGORIZE_TOOL)
        result = validate_categorize(result)
    except AssertionError as exc:
        log.error("Validation error: %s", exc)
        return jsonify({"error": "Validation failed", "detail": str(exc)}), 500
    except Exception as exc:
        log.error("Claude call failed: %s", exc)
        return jsonify({"error": "Agent unavailable"}), 503

    return jsonify(result)


@app.route("/pipeline", methods=["POST"])
def pipeline():
    data = request.get_json()
    if not data:
        return jsonify({"error": "Request body with deal data required"}), 400

    messages = [{"role": "user", "content": f"Assess this deal and recommend the correct pipeline stage:\\n{data}"}]

    try:
        result = call_with_tool(messages, PIPELINE_TOOL)
        result = validate_pipeline(result)
    except AssertionError as exc:
        log.error("Validation error: %s", exc)
        return jsonify({"error": "Validation failed", "detail": str(exc)}), 500
    except Exception as exc:
        log.error("Claude call failed: %s", exc)
        return jsonify({"error": "Agent unavailable"}), 503

    return jsonify(result)


@app.route("/checkin", methods=["POST"])
def checkin():
    data = request.get_json() or {}
    customer_name = data.get("customer_name", "").strip()
    company       = data.get("company", "").strip()
    context       = data.get("context", "No additional context.")

    if not customer_name:
        return jsonify({"error": "customer_name is required"}), 400

    prompt = (
        f"Draft a personalised check-in email for {customer_name}"
        + (f" at {company}" if company else "")
        + f". Context: {context}"
    )
    messages = [{"role": "user", "content": prompt}]

    try:
        result = call_with_tool(messages, CHECKIN_TOOL)
        result = validate_checkin(result)
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


@app.route("/sync", methods=["POST"])
def sync():
    if airtable_customers is None:
        return jsonify({"error": "Airtable integration not configured. Set AIRTABLE_TOKEN and AIRTABLE_BASE_ID."}), 503

    data = request.get_json() or {}
    record_id = (data.get("record_id") or "").strip()
    if not record_id:
        return jsonify({"error": "record_id is required"}), 400

    try:
        record = airtable_customers.get(record_id)
    except Exception as exc:
        log.error("Airtable fetch failed for %s: %s", record_id, exc)
        return jsonify({"error": "Failed to fetch record from Airtable", "detail": str(exc)}), 502

    fields = record.get("fields", {})

    # Ask Claude to enrich the raw Airtable record with CRM insights
    messages = [{"role": "user", "content": f"Enrich this Airtable customer record with CRM insights:\\n{fields}"}]
    try:
        enriched = call_with_tool(messages, CATEGORIZE_TOOL)
        enriched = validate_categorize(enriched)
    except Exception as exc:
        log.warning("Enrichment skipped — Claude unavailable: %s", exc)
        enriched = {}

    return jsonify({"record_id": record_id, "fields": fields, "enrichment": enriched})


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
    log.info("CRM agent running on port %d", port)
    app.run(host="0.0.0.0", port=port)
`,
};
