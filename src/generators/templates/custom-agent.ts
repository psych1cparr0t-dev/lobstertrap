import { AgentTemplate } from './index';

export const customAgentTemplate: AgentTemplate = {
  name: 'Custom Agent',
  description: 'Blank template — build your own agent',
  agentCode: `#!/usr/bin/env python3
"""
Custom Agent — powered by Claude
==================================
A production-ready starter template. Rename it, extend it, and deploy it.

Out of the box this agent can:
  - Answer single questions via POST /process
  - Hold multi-turn conversations via POST /chat (with per-session history)
  - Report its own health and runtime stats via GET /health and GET /status

The system prompt — and therefore the agent's entire personality and purpose —
is configured through a single environment variable, requiring no code changes.

Environment Variables
---------------------
Required:
  ANTHROPIC_API_KEY   Your Anthropic API key.

Optional:
  SYSTEM_PROMPT       The system prompt passed to Claude on every request.
                      Defaults to "You are a helpful AI assistant."
                      Override to give the agent a specific role, persona,
                      or set of constraints without touching this file.
  PORT                Port to listen on (default: 8000).

Endpoints
---------
  GET  /health
       Liveness check — returns agent name and version.
       curl http://localhost:8000/health

  GET  /status
       Runtime stats: uptime, total requests handled, active sessions.
       curl http://localhost:8000/status

  POST /process
       Single-turn: send an input, get an output. No history kept.
       curl -X POST http://localhost:8000/process \\
            -H 'Content-Type: application/json' \\
            -d '{"input": "Explain quantum entanglement in one sentence."}'

  POST /chat
       Multi-turn conversation with per-session history (max 20 turns).
       curl -X POST http://localhost:8000/chat \\
            -H 'Content-Type: application/json' \\
            -d '{"message": "Hello!", "session_id": "user-42"}'

  POST /chat/reset
       Clear the history for a specific session.
       curl -X POST http://localhost:8000/chat/reset \\
            -H 'Content-Type: application/json' \\
            -d '{"session_id": "user-42"}'
"""

import os
import json
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

# ── Configuration ─────────────────────────────────────────────────────────────

DEFAULT_SYSTEM_PROMPT = os.environ.get(
    "SYSTEM_PROMPT",
    (
        "You are a helpful AI assistant. Answer questions clearly and concisely. "
        "If you are unsure about something, say so rather than guessing."
    ),
)

# agent_config.json lives next to this file and is the live-editable config store.
# /configure rewrites it; load_system_prompt() reads it fresh on every request.
CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "agent_config.json")

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

MAX_SESSION_TURNS = 20  # maximum user+assistant turn pairs stored per session

# ── Module-level state ────────────────────────────────────────────────────────

# These are read by /status to report runtime metrics.
_start_time: float = time.time()
_request_count: int = 0

# Per-session message histories for /chat.
# Key: session_id (any string the caller supplies).
# Value: list of {"role": "user"|"assistant", "content": "..."} dicts.
sessions: dict[str, list[dict]] = {}


# ── Session helpers ───────────────────────────────────────────────────────────

def append_turn(session_id: str, role: str, content: str) -> list:
    """Append a message to the session history, pruning if it exceeds the limit."""
    turns = sessions.setdefault(session_id, [])
    turns.append({"role": role, "content": content})
    # Each "turn" is a user+assistant pair, so the list holds at most MAX_SESSION_TURNS*2 messages.
    if len(turns) > MAX_SESSION_TURNS * 2:
        sessions[session_id] = turns[-(MAX_SESSION_TURNS * 2):]
    return sessions[session_id]


# ── Error handlers — always return JSON, never HTML ───────────────────────────

@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "not found"}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "method not allowed"}), 405

@app.errorhandler(500)
def internal_error(e):
    return jsonify({"error": "internal server error"}), 500


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.route("/health")
def health():
    """Liveness check."""
    return jsonify({
        "status": "healthy",
        "agent": "custom",
        "version": "1.0.0",
    })


@app.route("/status")
def status():
    """Runtime metrics — useful for dashboards and alerting."""
    return jsonify({
        "status": "running",
        "uptime_seconds": round(time.time() - _start_time, 1),
        "request_count": _request_count,
        "active_sessions": len(sessions),
    })


@app.route("/process", methods=["POST"])
def process():
    """
    Single-turn endpoint. No conversation history is stored.
    Useful for one-shot tasks: classification, summarisation, extraction, etc.

    Request:  {"input": "your text here"}
    Response: {"output": "Claude's response"}
    """
    global _request_count
    _request_count += 1

    data = request.get_json(silent=True)
    if not data or not str(data.get("input", "")).strip():
        return jsonify({"error": "input field required and must not be blank"}), 400

    user_input = str(data["input"]).strip()

    try:
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=load_system_prompt(),
            messages=[{"role": "user", "content": user_input}],
        )
        output = response.content[0].text
    except Exception as exc:
        log.error("Claude call failed: %s", exc)
        return jsonify({"error": "Agent unavailable — please try again"}), 503

    return jsonify({"output": output})


@app.route("/chat", methods=["POST"])
def chat():
    """
    Multi-turn conversational endpoint.
    Maintains per-session history so Claude can reference earlier messages.

    Request:  {"message": "...", "session_id": "..."}   (session_id defaults to "default")
    Response: {"reply": "...", "session_id": "..."}
    """
    global _request_count
    _request_count += 1

    data = request.get_json(silent=True)
    if not data or not str(data.get("message", "")).strip():
        return jsonify({"error": "message field required and must not be blank"}), 400

    session_id = str(data.get("session_id", "default"))
    user_msg   = str(data["message"]).strip()

    # Append the user's message and pass the full history to Claude.
    history = append_turn(session_id, "user", user_msg)

    try:
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=load_system_prompt(),  # hot-reloaded on every request
            messages=history,
        )
        reply = response.content[0].text
    except Exception as exc:
        log.error("Claude call failed: %s", exc)
        return jsonify({"error": "Agent unavailable — please try again"}), 503

    append_turn(session_id, "assistant", reply)

    return jsonify({
        "reply":      reply,
        "session_id": session_id,
    })


@app.route("/configure", methods=["POST"])
def configure():
    """
    Hot-reload the system prompt without restarting the agent.
    Accepts a plain-English instruction and Claude rewrites the prompt accordingly.

    Request:  {"instruction": "be more concise and always respond in bullet points"}
    Response: {"ok": true, "system_prompt": "<new prompt>"}
    """
    global _request_count
    _request_count += 1

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
                f"Current system prompt:\\n{current}\\n\\n"
                f"Instruction: {instruction}\\n\\n"
                "Rewrite the system prompt to incorporate this instruction. "
                "Keep the same format, style, and level of detail. "
                "Return ONLY the updated system prompt text, no explanation."
            )}],
        )
        new_prompt = resp.content[0].text.strip()
    except Exception as exc:
        log.error("Claude configure call failed: %s", exc)
        return jsonify({"error": "Could not update system prompt"}), 503

    save_system_prompt(new_prompt)
    log.info("System prompt updated via /configure")
    return jsonify({"ok": True, "system_prompt": new_prompt})


@app.route("/chat/reset", methods=["POST"])
def chat_reset():
    """Clear the conversation history for a session."""
    data = request.get_json(silent=True) or {}
    session_id = str(data.get("session_id", "default"))
    sessions.pop(session_id, None)
    return jsonify({"session_id": session_id, "cleared": True})


# ── Entry ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    log.info("Custom agent on port %d", port)
    log.info("System prompt: %s", SYSTEM_PROMPT[:80] + ("..." if len(SYSTEM_PROMPT) > 80 else ""))
    app.run(host="0.0.0.0", port=port)
`,
};
