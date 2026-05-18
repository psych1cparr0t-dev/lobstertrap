import { AgentTemplate } from './index';

export const customerServiceAgentTemplate: AgentTemplate = {
  name: 'Customer Service Agent',
  description: 'Live chat, Twilio voice + SMS, session context, structured Claude tool use',
  agentCode: `#!/usr/bin/env python3
"""
Customer Service Agent — powered by Claude
============================================
Handles live chat, Twilio voice calls, and SMS with full per-session context.
Uses Claude tool use for guaranteed structured output — no JSON parsing fragility.

Environment Variables
---------------------
Required:
  ANTHROPIC_API_KEY        Your Anthropic API key.

Optional (Twilio — voice and SMS disabled if absent):
  TWILIO_ACCOUNT_SID       Twilio account SID.
  TWILIO_AUTH_TOKEN        Twilio auth token (also used to validate inbound requests).
  ESCALATION_PHONE_NUMBER  E.164 number to dial when Claude sets escalate=true (e.g. +15551234567).

General:
  PORT                     Port to listen on (default: 8000).

Endpoints
---------
  GET  /health
       Returns agent status and Twilio availability.
       curl http://localhost:8000/health

  GET  /status
       Returns active session count and uptime in seconds.
       curl http://localhost:8000/status

  POST /chat
       Live chat with session history (max 20 turns).
       curl -X POST http://localhost:8000/chat \\
            -H 'Content-Type: application/json' \\
            -d '{"message": "My order never arrived.", "session_id": "user-123"}'

  POST /chat/reset
       Clear a session's conversation history.
       curl -X POST http://localhost:8000/chat/reset \\
            -H 'Content-Type: application/json' \\
            -d '{"session_id": "user-123"}'

  POST /voice             (Twilio webhook — call arrives)
  POST /voice/respond     (Twilio webhook — transcribed speech)
  POST /sms               (Twilio webhook — inbound SMS)
"""

import os
import time
import logging
from flask import Flask, request, jsonify, Response
from anthropic import Anthropic
from dotenv import load_dotenv

try:
    from twilio.twiml.voice_response import VoiceResponse, Gather
    from twilio.twiml.messaging_response import MessagingResponse
    from twilio.request_validator import RequestValidator
    TWILIO_AVAILABLE = True
except ImportError:
    TWILIO_AVAILABLE = False

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# Warn about missing optional env vars so operators know what's disabled.
if not TWILIO_AVAILABLE:
    log.warning("twilio package not installed — voice and SMS endpoints are disabled")
elif not (os.getenv("TWILIO_ACCOUNT_SID") and os.getenv("TWILIO_AUTH_TOKEN")):
    log.warning("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set — voice and SMS disabled")
if not os.getenv("ESCALATION_PHONE_NUMBER"):
    log.warning("ESCALATION_PHONE_NUMBER not set — escalation calls will announce a transfer but not dial")

app = Flask(__name__)
client = Anthropic()

# Track uptime for /status
_start_time = time.time()

# In-memory session store (swap for Redis in production).
# Keyed by session_id (chat) or CallSid (voice) or From number (SMS).
sessions: dict[str, list[dict]] = {}
MAX_SESSION_TURNS = 20  # maximum user+assistant turn pairs to keep per session

SYSTEM_PROMPT = """You are a warm, professional customer service representative for a consumer brand.

Your role:
- Greet customers by acknowledging their concern before jumping into solutions.
- Be empathetic, clear, and concise: under 3 sentences for voice; under 150 words for chat.
- Never fabricate policy details, order data, or pricing. If you don't know, say so honestly
  and offer to connect the customer with a specialist.
- For voice interactions: speak naturally, avoid bullet points, use short conversational sentences.
- Always verify the issue is resolved before closing — ask "Is there anything else I can help with?"
- Escalate to a human agent if the customer is very distressed, the issue is unresolved after two
  attempts, or the customer explicitly requests a human.

Issue categories: billing, technical, account, returns, general."""


# ── Shared retry wrapper ─────────────────────────────────────────────────────

def call_claude_with_retry(messages: list, tools: list, max_retries: int = 3) -> dict:
    """
    Call Claude with tool_choice=any so a tool call is always returned.
    Retries up to max_retries times with exponential backoff on transient failures.
    """
    for attempt in range(max_retries):
        try:
            response = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=1024,
                system=SYSTEM_PROMPT,
                tools=tools,
                tool_choice={"type": "any"},
                messages=messages,
            )
            for block in response.content:
                if block.type == "tool_use":
                    return block.input
            raise ValueError("No tool_use block in response")
        except Exception as exc:
            if attempt == max_retries - 1:
                log.error("Claude call failed after %d attempts: %s", max_retries, exc)
                raise
            wait = 0.5 * (2 ** attempt)
            log.warning("Claude attempt %d failed, retrying in %.1fs: %s", attempt + 1, wait, exc)
            time.sleep(wait)


# ── Tool schemas ─────────────────────────────────────────────────────────────

CHAT_TOOL = {
    "name": "respond_to_customer",
    "description": (
        "Analyse the customer's message in the context of the conversation history and produce a "
        "structured response. Classify intent and sentiment accurately — these fields are used to "
        "route tickets and measure satisfaction. Set escalate=true if the customer is very upset, "
        "has asked for a human, or if two consecutive turns have failed to resolve the issue. "
        "Set resolved=true only when you are confident the customer's concern has been addressed."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "intent": {
                "type": "string",
                "enum": ["billing", "technical", "account", "returns", "general"],
                "description": "Primary category of the customer's concern.",
            },
            "sentiment": {
                "type": "string",
                "enum": ["angry", "frustrated", "neutral", "satisfied"],
                "description": "Customer's emotional tone in this turn.",
            },
            "priority": {
                "type": "string",
                "enum": ["urgent", "high", "medium", "low"],
                "description": "Urgency level. Use 'urgent' for service outages or financial disputes.",
            },
            "response": {
                "type": "string",
                "description": (
                    "The reply to send to the customer. Be warm and helpful. "
                    "Under 150 words. No markdown formatting — plain prose only."
                ),
            },
            "resolved": {
                "type": "boolean",
                "description": "True if the customer's issue appears fully resolved this turn.",
            },
            "escalate": {
                "type": "boolean",
                "description": "True if a human agent should take over this conversation.",
            },
        },
        "required": ["intent", "sentiment", "priority", "response", "resolved", "escalate"],
    },
}

VOICE_TOOL = {
    "name": "voice_response",
    "description": (
        "Generate a spoken response to the customer's transcribed speech. "
        "The text will be passed directly to a text-to-speech engine, so it must sound natural "
        "when read aloud: no bullet points, no markdown, no abbreviations, no ellipses. "
        "Keep it under 40 words so callers are not overwhelmed. "
        "Set escalate=true if the customer asks for a human or the issue cannot be resolved over the phone."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "spoken_response": {
                "type": "string",
                "description": (
                    "Plain-text response to speak aloud. Under 40 words. "
                    "No punctuation other than commas and periods. Conversational tone."
                ),
            },
            "intent": {
                "type": "string",
                "enum": ["billing", "technical", "account", "returns", "general"],
            },
            "resolved": {"type": "boolean"},
            "escalate": {"type": "boolean"},
        },
        "required": ["spoken_response", "intent", "resolved", "escalate"],
    },
}


# ── Validation ───────────────────────────────────────────────────────────────

VALID_INTENTS   = {"billing", "technical", "account", "returns", "general"}
VALID_SENTIMENT = {"angry", "frustrated", "neutral", "satisfied"}
VALID_PRIORITY  = {"urgent", "high", "medium", "low"}

def validate_chat_result(result: dict) -> dict:
    assert result.get("intent")    in VALID_INTENTS,   f"Bad intent: {result.get('intent')}"
    assert result.get("sentiment") in VALID_SENTIMENT, f"Bad sentiment: {result.get('sentiment')}"
    assert result.get("priority")  in VALID_PRIORITY,  f"Bad priority: {result.get('priority')}"
    assert isinstance(result.get("response"), str) and result["response"].strip(), "Empty response"
    assert isinstance(result.get("resolved"), bool), "resolved must be bool"
    assert isinstance(result.get("escalate"), bool), "escalate must be bool"
    return result

def validate_voice_result(result: dict) -> dict:
    assert result.get("intent") in VALID_INTENTS, f"Bad intent: {result.get('intent')}"
    spoken = result.get("spoken_response", "").strip()
    assert spoken, "Empty spoken_response"
    assert len(spoken.split()) <= 60, "spoken_response too long for voice"
    return result


# ── Session helpers ──────────────────────────────────────────────────────────

def get_session(session_id: str) -> list:
    return sessions.get(session_id, [])

def append_turn(session_id: str, role: str, content: str) -> list:
    turns = sessions.setdefault(session_id, [])
    turns.append({"role": role, "content": content})
    # Prune oldest turns to stay within the token budget.
    # Each "turn" is a user+assistant pair, so we store at most MAX_SESSION_TURNS*2 messages.
    if len(turns) > MAX_SESSION_TURNS * 2:
        sessions[session_id] = turns[-(MAX_SESSION_TURNS * 2):]
    return sessions[session_id]


# ── Twilio helpers ───────────────────────────────────────────────────────────

def twilio_available() -> bool:
    if not TWILIO_AVAILABLE:
        return False
    return bool(os.getenv("TWILIO_ACCOUNT_SID") and os.getenv("TWILIO_AUTH_TOKEN"))

def validate_twilio_request() -> bool:
    """Return True if the request came from Twilio (or if running in dev mode)."""
    if not twilio_available():
        return True  # dev mode — skip signature validation
    validator = RequestValidator(os.getenv("TWILIO_AUTH_TOKEN"))
    return validator.validate(
        request.url,
        request.form,
        request.headers.get("X-Twilio-Signature", ""),
    )


# ── Endpoints ────────────────────────────────────────────────────────────────

@app.errorhandler(404)
def not_found(e):
    return jsonify({"error": "not found"}), 404

@app.errorhandler(405)
def method_not_allowed(e):
    return jsonify({"error": "method not allowed"}), 405

@app.errorhandler(500)
def internal_error(e):
    return jsonify({"error": "internal server error"}), 500


@app.route("/health")
def health():
    return jsonify({
        "status": "healthy",
        "agent": "customer-service",
        "version": "1.0.0",
        "twilio": twilio_available(),
    })


@app.route("/status")
def status():
    return jsonify({
        "status": "running",
        "uptime_seconds": round(time.time() - _start_time, 1),
        "active_sessions": len(sessions),
    })


@app.route("/chat", methods=["POST"])
def chat():
    data = request.get_json(silent=True)
    if not data or not data.get("message"):
        return jsonify({"error": "message required"}), 400

    session_id = data.get("session_id", "default")
    user_msg   = data["message"].strip()

    if not user_msg:
        return jsonify({"error": "message must not be blank"}), 400

    history = append_turn(session_id, "user", user_msg)

    try:
        result = call_claude_with_retry(history, [CHAT_TOOL])
        result = validate_chat_result(result)
    except AssertionError as exc:
        log.error("Validation failed: %s", exc)
        return jsonify({"error": "Agent response failed validation", "detail": str(exc)}), 500
    except Exception as exc:
        log.error("Claude call failed: %s", exc)
        return jsonify({"error": "Agent unavailable — please try again"}), 503

    append_turn(session_id, "assistant", result["response"])

    return jsonify({
        "session_id": session_id,
        "reply":      result["response"],
        "intent":     result["intent"],
        "sentiment":  result["sentiment"],
        "priority":   result["priority"],
        "resolved":   result["resolved"],
        "escalate":   result["escalate"],
    })


@app.route("/chat/reset", methods=["POST"])
def chat_reset():
    data = request.get_json(silent=True) or {}
    session_id = data.get("session_id", "default")
    sessions.pop(session_id, None)
    return jsonify({"session_id": session_id, "cleared": True})


# ── Twilio Voice ─────────────────────────────────────────────────────────────

@app.route("/voice", methods=["POST"])
def voice_incoming():
    """Twilio webhook — called when an inbound call arrives."""
    if not validate_twilio_request():
        return Response("Forbidden", status=403)

    resp = VoiceResponse()
    gather = Gather(
        input="speech",
        action="/voice/respond",
        method="POST",
        speech_timeout="auto",
        language="en-US",
    )
    gather.say(
        "Hi, thanks for calling customer support. How can I help you today?",
        voice="Polly.Joanna",
    )
    resp.append(gather)
    # Fallback if the caller says nothing
    resp.say("I didn't catch that — please call back and try again.", voice="Polly.Joanna")
    return Response(str(resp), mimetype="text/xml")


@app.route("/voice/respond", methods=["POST"])
def voice_respond():
    """Twilio webhook — receives transcribed speech and returns a <Say> response."""
    if not validate_twilio_request():
        return Response("Forbidden", status=403)

    speech   = request.form.get("SpeechResult", "").strip()
    call_sid = request.form.get("CallSid", "unknown")

    if not speech:
        resp = VoiceResponse()
        resp.say("Sorry, I couldn't understand that. Could you repeat?", voice="Polly.Joanna")
        resp.redirect("/voice")
        return Response(str(resp), mimetype="text/xml")

    log.info("Voice [%s]: %s", call_sid, speech)
    history = append_turn(call_sid, "user", speech)

    spoken = "I'm having trouble right now. Please hold while I connect you to an agent."
    result = {"escalate": True, "resolved": False}

    try:
        result = call_claude_with_retry(history, [VOICE_TOOL])
        result = validate_voice_result(result)
        spoken = result["spoken_response"]
    except Exception as exc:
        log.error("Voice Claude call failed: %s", exc)

    append_turn(call_sid, "assistant", spoken)

    resp = VoiceResponse()

    if result.get("escalate"):
        resp.say(spoken, voice="Polly.Joanna")
        escalation_number = os.getenv("ESCALATION_PHONE_NUMBER")
        if escalation_number:
            resp.dial(escalation_number)
        else:
            resp.say("Please hold — transferring you to an agent now.", voice="Polly.Joanna")
    elif result.get("resolved"):
        resp.say(spoken, voice="Polly.Joanna")
        gather = Gather(input="speech", action="/voice/respond", method="POST", speech_timeout="auto")
        gather.say("Is there anything else I can help with?", voice="Polly.Joanna")
        resp.append(gather)
    else:
        resp.say(spoken, voice="Polly.Joanna")
        gather = Gather(input="speech", action="/voice/respond", method="POST", speech_timeout="auto")
        resp.append(gather)

    return Response(str(resp), mimetype="text/xml")


# ── Twilio SMS ───────────────────────────────────────────────────────────────

@app.route("/sms", methods=["POST"])
def sms_incoming():
    """Twilio webhook — receives an inbound SMS and replies via TwiML."""
    if not validate_twilio_request():
        return Response("Forbidden", status=403)

    from_number = request.form.get("From", "unknown")
    body        = request.form.get("Body", "").strip()

    if not body:
        return Response(str(MessagingResponse()), mimetype="text/xml")

    log.info("SMS [%s]: %s", from_number, body)
    history = append_turn(from_number, "user", body)

    try:
        result = call_claude_with_retry(history, [CHAT_TOOL])
        result = validate_chat_result(result)
        reply  = result["response"]
    except Exception as exc:
        log.error("SMS Claude call failed: %s", exc)
        reply = "Sorry, I'm having trouble right now. Please try again in a moment."

    append_turn(from_number, "assistant", reply)

    msg_resp = MessagingResponse()
    msg_resp.message(reply)
    return Response(str(msg_resp), mimetype="text/xml")


# ── Entry ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    log.info("Customer service agent on port %d (Twilio: %s)", port, twilio_available())
    app.run(host="0.0.0.0", port=port)
`,
};
