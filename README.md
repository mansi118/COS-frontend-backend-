# NeuralEDGE — PULSE Command Center

**Chief of Staff Dashboard** for NeuralEDGE, powered by [Convex](https://convex.dev) database and [OpenClaw](https://openclaw.dev) AI agent integration.

A real-time operational dashboard managing follow-ups, clients, sprints, team performance, meetings, standups, voice updates, and meeting intelligence.

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌────────────────┐
│   Frontend       │────▶│    Backend        │────▶│   Convex DB    │
│   Next.js 14     │     │    FastAPI        │     │   (cloud)      │
│   :3000          │◀────│    :8000          │◀────│                │
│                  │ WS  │                   │     └────────────────┘
└─────────────────┘     └────────┬──────────┘
                                │
                   ┌────────────▼────────────┐
                   │   OpenClaw Gateway      │
                   │   :18789                │
                   │   AI Agent Execution    │
                   └─────────────────────────┘
```

### Data Flow

1. **Frontend** calls Backend API endpoints
2. **Backend** reads/writes Convex database (sole data source)
3. **Execution** — action buttons delegate to OpenClaw gateway
4. **OpenClaw** skills process tasks and write results back via Backend API

---

## Tech Stack

| Component | Technology | Port |
|-----------|-----------|------|
| Frontend | Next.js 14, React 18, TypeScript, Tailwind CSS, Recharts | 3000 |
| Backend | FastAPI, Pydantic, httpx, Convex Python SDK | 8000 |
| Database | Convex (cloud) | — |
| AI Agent | OpenClaw Gateway (token auth) | 18789 |
| Voice Storage | AWS S3 (with local fallback) | — |

---

## Project Structure

```
frontend-design-cos/
├── README.md
│
├── backend/
│   ├── main.py                 # FastAPI app, WebSocket, auto-email scheduler
│   ├── gateway.py              # OpenClaw gateway client
│   ├── convex_db.py            # Convex database client (sole data source)
│   ├── schemas.py              # Pydantic request/response schemas
│   ├── standup_service.py      # Standup CRUD via Convex
│   ├── taskflow_service.py     # TaskFlow CRUD + analytics via Convex
│   ├── standup_fanout.py       # Auto-create follow-ups/tasks from standups
│   ├── requirements.txt
│   ├── .env                    # Credentials (SMTP, Slack, Convex, S3, Vexa)
│   ├── services/
│   │   ├── voice_storage.py    # S3 audio upload/download
│   │   └── voice_router.py     # Auto-route voice updates
│   └── routers/                # 18 API routers (82 endpoints)
│       ├── pulse.py            # PULSE board + CEO summary
│       ├── followups.py        # Follow-up CRUD
│       ├── standups.py         # Daily standups
│       ├── taskflow.py         # TaskFlow management
│       ├── sprint.py           # Sprint tracking
│       ├── clients.py          # Client management
│       ├── performance.py      # Team performance
│       ├── briefing.py         # Morning/EOD briefings
│       ├── voice.py            # Voice recording + transcription
│       ├── fireflies.py        # Vexa meeting intelligence
│       ├── email.py            # Email (AWS SES)
│       ├── slack.py            # Slack integration
│       ├── whatsapp.py         # WhatsApp (Twilio)
│       ├── meetings.py         # Calendar meetings
│       ├── vault.py            # Knowledge vault
│       ├── tasks.py            # Simple task list
│       ├── execute.py          # OpenClaw execution
│       └── gmail.py            # Gmail integration
│
├── convex/
│   ├── schema.ts               # 22 tables
│   ├── followups.ts            # Follow-up queries/mutations
│   ├── team_members.ts         # Team roster
│   ├── clients.ts              # Client management
│   ├── sprints.ts              # Sprint + sprint updates
│   ├── standups.ts             # Daily standups
│   ├── tasks.ts                # TaskFlow tasks
│   ├── taskflow_meta.ts        # Projects, areas, tags
│   ├── voice_updates.ts        # Voice recordings
│   ├── vexa_meetings.ts        # Meeting records
│   ├── performance.ts          # Performance snapshots
│   ├── notifications.ts        # Notification logs
│   ├── board_snapshots.ts      # Board state snapshots
│   ├── notification_config.ts  # Team routing config
│   ├── calendar_meetings.ts    # Calendar data
│   ├── vault_entries.ts        # Vault documents
│   ├── counters.ts             # Atomic ID counters
│   ├── pulse_snapshots.ts      # Daily pulse stats
│   └── eod_snapshots.ts        # EOD summaries
│
└── frontend/
    ├── app/                    # 12 pages
    └── components/             # Shared UI components
```

---

## Setup & Running

### Prerequisites

- Node.js 20+
- Python 3.11+
- Convex account (https://convex.dev)
- OpenClaw gateway running on port 18789

### 1. Backend

```bash
cd backend
pip install -r requirements.txt

# Set environment variables
export $(grep -v '^#' .env | xargs)

# Start the server
uvicorn main:app --reload --port 8000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

### 3. Convex

```bash
npx convex dev
```

---

## Convex Database (22 tables)

| Table | Records | Purpose |
|-------|---------|---------|
| team_members | 6 | Team roster |
| followups | 39+ | Action items with checklists |
| clients | 4 | Client health + pipeline |
| client_contacts | 6 | Client contact persons |
| sprints | 1 | Active sprint |
| sprint_updates | — | Weekly standup summaries |
| standups | 15+ | Daily standups |
| tasks | 28+ | TaskFlow tasks |
| taskflow_projects | 3 | Project metadata |
| performance_snapshots | 4 | Team evaluations |
| voice_updates | 8 | Voice recordings |
| vexa_meetings | 2 | Meeting records (Vexa) |
| notification_config | 1 | Team routing rules |
| calendar_meetings | 2 | Google Calendar data |
| vault_entries | 2 | Knowledge documents |
| counters | 3 | Atomic ID generation |
| pulse_snapshots | 5+ | Daily sparkline data |
| eod_snapshots | 1 | EOD briefings |
| notification_logs | — | Send history |
| board_snapshots | — | Board state history |
| taskflow_areas | — | Area metadata |
| taskflow_tags | — | Tag metadata |

---

## E2E Test Suite

```bash
python3 /tmp/test-e2e-full.py
```

76 tests across 4 categories:
- **A:** 43 read endpoint tests
- **B:** 13 write/CRUD tests
- **C:** 14 Convex data integrity checks
- **D:** 6 no-local-file dependency checks

---

## License

Proprietary — NeuralEDGE. All rights reserved.
