import { AgentTemplate } from './index';

export const customerServiceAgentTemplate: AgentTemplate = {
  name: 'Customer Service Agent',
  description: 'Live chat, Twilio voice + SMS, session context, structured Claude tool use',
  agentCode: `#!/usr/bin/env python3
"""
Customer Service Agent — powered by Claude
Handles live chat, Twilio voice calls, and SMS with full session context.
Uses Claude tool use for guaranteed structured output — no JSON parsing fragility.
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

app = Flask(__name__)
client = Anthropic()

# ── In-memory session store (swap for Redis in production) ──────────────────
# Keyed by session_id (chat) or CallSid (voice) or From number (SMS)
sessions: dict[str, list[dict]] = {}
MAX_SESSION_TURNS = 20  # prune old turns to keep context manageable

SYSTEM_PROMPT = """You are a warm, professional customer service agent.

Guidelines:
- Be empathetic and concise (under 3 sentences for voice; under 150 words for chat)
- Acknowledge the customer's emotion before offering solutions
- Never fabricate policy details — say "I'll check on that" if unsure
- For voice: speak naturally, avoid bullet points, use short sentences
- Always confirm you've resolved the issue before ending

Categories: billing, technical, account, returns, general"""


# ── Shared retry wrapper ─────────────────────────────────────────────────────

def call_claude_with_retry(messages: list, tools: list, max_retries: int = 3) -> dict:
    """
    Call Claude with tool_choice=any to guarantee a tool call is returned.
    Retries with exponential backoff on transient failures.
    """
    for attempt in range(max_retries):
        try:
            response = client.messages.create(
                model="claude-opus-4-7",
                max_tokens=1024,
                system=SYSTEM_PROMPT,
                tools=tools,
                tool_choice={"type": "any"},  # forces Claude to always call a tool
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
            log.warning("Claude call failed (attempt %d), retrying in %.1fs: %s", attempt + 1, wait, exc)
            time.sleep(wait)


# ── Tool schemas ─────────────────────────────────────────────────────────────

CHAT_TOOL = {
    "name": "respond_to_customer",
    "description": "Analyse the customer message and generate a structured response",
    "input_schema": {
        "type": "object",
        "properties": {
            "intent":    {"type": "string", "enum": ["billing", "technical", "account", "returns", "general"]},
            "sentiment": {"type": "string", "enum": ["angry", "frustrated", "neutral", "satisfied"]},
            "priority":  {"type": "string", "enum": ["urgent", "high", "medium", "low"]},
            "response":  {"type": "string", "description": "The reply to send to the customer"},
            "resolved":  {"type": "boolean", "description": "Whether the issue appears resolved"},
            "escalate":  {"type": "boolean", "description": "Whether a human agent should take over"},
        },
        "required": ["intent", "sentiment", "priority", "response", "resolved", "escalate"],
    },
}

VOICE_TOOL = {
    "name": "voice_response",
    "description": "Generate a spoken response to the customer's voice input",
    "input_schema": {
        "type": "object",
        "properties": {
            "spoken_response": {
                "type": "string",
                "description": "What to say aloud — plain text, no markdown, under 40 words",
            },
            "intent":   {"type": "string", "enum": ["billing", "technical", "account", "returns", "general"]},
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
    # Keep only the last N turns to avoid token bloat
    if len(turns) > MAX_SESSION_TURNS * 2:
        sessions[session_id] = turns[-(MAX_SESSION_TURNS * 2):]
    return sessions[session_id]


# ── Twilio helpers ───────────────────────────────────────────────────────────

def twilio_available() -> bool:
    if not TWILIO_AVAILABLE:
        return False
    return bool(os.getenv("TWILIO_ACCOUNT_SID") and os.getenv("TWILIO_AUTH_TOKEN"))

def validate_twilio_request() -> bool:
    """Validate that the request genuinely comes from Twilio."""
    if not twilio_available():
        return True  # dev mode — skip validation
    validator = RequestValidator(os.getenv("TWILIO_AUTH_TOKEN"))
    return validator.validate(
        request.url,
        request.form,
        request.headers.get("X-Twilio-Signature", ""),
    )


# ── Endpoints ────────────────────────────────────────────────────────────────

@app.route("/health")
def health():
    return jsonify({
        "status": "healthy",
        "agent": "customer-service",
        "twilio": twilio_available(),
    })


@app.route("/chat", methods=["POST"])
def chat():
    """
    Live chat endpoint. Maintains per-session conversation history.

    Body: { "session_id": "user-123", "message": "My order is wrong." }
    """
    data = request.get_json()
    if not data or not data.get("message"):
        return jsonify({"error": "message required"}), 400

    session_id = data.get("session_id", "default")
    user_msg   = data["message"].strip()

    history = append_turn(session_id, "user", user_msg)

    try:
        result = call_claude_with_retry(history, [CHAT_TOOL])
        result = validate_chat_result(result)
    except AssertionError as e:
        log.error("Validation failed: %s", e)
        return jsonify({"error": "Agent response failed validation", "detail": str(e)}), 500
    except Exception as e:
        log.error("Claude call failed: %s", e)
        return jsonify({"error": "Agent unavailable, please try again"}), 503

    append_turn(session_id, "assistant", result["response"])

    return jsonify({
        "session_id": session_id,
        "response":   result["response"],
        "intent":     result["intent"],
        "sentiment":  result["sentiment"],
        "priority":   result["priority"],
        "resolved":   result["resolved"],
        "escalate":   result["escalate"],
    })


@app.route("/chat/reset", methods=["POST"])
def chat_reset():
    """Clear a session's conversation history."""
    data = request.get_json() or {}
    session_id = data.get("session_id", "default")
    sessions.pop(session_id, None)
    return jsonify({"session_id": session_id, "cleared": True})


# ── Twilio Voice ─────────────────────────────────────────────────────────────

@app.route("/voice", methods=["POST"])
def voice_incoming():
    """
    Twilio calls this when a call arrives.
    Returns TwiML to greet the caller and gather their speech.
    """
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
        "Hi, you've reached customer support. How can I help you today?",
        voice="Polly.Joanna",
    )
    resp.append(gather)
    resp.say("I didn't catch that — please call back and try again.")
    return Response(str(resp), mimetype="text/xml")


@app.route("/voice/respond", methods=["POST"])
def voice_respond():
    """
    Twilio sends the transcribed speech here.
    We call Claude, get a spoken response, return TwiML <Say>.
    """
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

    try:
        result = call_claude_with_retry(history, [VOICE_TOOL])
        result = validate_voice_result(result)
        spoken = result["spoken_response"]
    except Exception as e:
        log.error("Voice Claude call failed: %s", e)
        spoken = "I'm having trouble right now. Please hold while I connect you to an agent."

    append_turn(call_sid, "assistant", spoken)

    resp = VoiceResponse()

    if result.get("escalate"):
        resp.say(spoken, voice="Polly.Joanna")
        escalation_number = os.getenv("ESCALATION_PHONE_NUMBER")
        if escalation_number:
            resp.dial(escalation_number)
        else:
            resp.say("Please hold — transferring you now.", voice="Polly.Joanna")
    elif result.get("resolved"):
        resp.say(spoken, voice="Polly.Joanna")
        resp.say("Is there anything else I can help with?", voice="Polly.Joanna")
        gather = Gather(input="speech", action="/voice/respond", method="POST", speech_timeout="auto")
        resp.append(gather)
    else:
        resp.say(spoken, voice="Polly.Joanna")
        gather = Gather(input="speech", action="/voice/respond", method="POST", speech_timeout="auto")
        resp.append(gather)

    return Response(str(resp), mimetype="text/xml")


# ── Twilio SMS ───────────────────────────────────────────────────────────────

@app.route("/sms", methods=["POST"])
def sms_incoming():
    """
    Twilio sends inbound SMS here.
    We maintain a per-phone-number session and reply with TwiML.
    """
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
    except Exception as e:
        log.error("SMS Claude call failed: %s", e)
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
