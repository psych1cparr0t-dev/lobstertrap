# 🦞 LobsterTrap

**Deploy agents to OpenClaw in 5 minutes.**

Choose a template, run a command, monitor from your dashboard.

---

## Quick Start

```bash
npm install -g lobstertrap

# 1. Initialize OpenClaw
lobstertrap init-openclaw

# 2. Create an agent
lobstertrap new

# 3. Check status
lobstertrap list
```

---

## Commands

| Command | Description |
|---|---|
| `init-openclaw` | Download and configure OpenClaw locally |
| `new` | Create a new agent from a template |
| `list` | List all deployed agents |
| `status <agent>` | Check agent health and status |
| `logs <agent>` | Tail agent logs (`-f` to follow) |
| `stop <agent>` | Stop a running agent |
| `restart <agent>` | Gracefully restart an agent |
| `scale <agent> <n>` | Scale to N replicas |
| `connect <agent> <service>` | Add an integration |

---

## Templates

| Template | What it does |
|---|---|
| **Sales Agent** | Score leads, generate outreach emails, track follow-ups |
| **CRM Agent** | Categorize customers, manage pipeline, surface insights |
| **Support Agent** | Triage tickets, draft responses, route to the right team |
| **Custom Agent** | Blank slate — build anything |

---

## Integrations

- **Gmail** — Read/send emails via OAuth2
- **Airtable** — Read/write tables via API token
- **Slack** — Send/receive messages via Bot Token

```bash
lobstertrap connect SalesBot gmail
```

---

## Example Flow

```bash
$ lobstertrap init-openclaw
✓ OpenClaw ready at ~/.lobstertrap/openclaw

$ lobstertrap new
? Agent name: SalesBot
? Template: Sales Agent
? Integrations: Gmail, Airtable
? Port: 8000
✓ Agent files generated

$ cd SalesBot
# Fill in .env with your API keys
$ docker build -t salesbot .
$ docker run -d --name salesbot -p 8000:8000 --env-file .env salesbot

$ curl http://localhost:8000/health
{"status": "healthy", "agent": "sales"}

$ lobstertrap logs SalesBot -f
```

---

## Pricing

| Plan | Price | Agents |
|---|---|---|
| Free | $0 | 1 agent |
| Pro | $29/mo | 5 agents |
| Enterprise | Custom | Unlimited |

---

## Stack

- **CLI**: Node.js + TypeScript
- **Agents**: Python + Claude API (Anthropic)
- **Runtime**: Docker + OpenClaw
- **Orchestration**: Kubernetes (optional)
