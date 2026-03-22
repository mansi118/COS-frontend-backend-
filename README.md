# NeuralEDGE — PULSE Command Center

**Chief of Staff Dashboard** for NeuralEDGE, powered by [OpenClaw](https://openclaw.dev) AI agent integration.

A real-time operational dashboard that serves as the UI layer for OpenClaw's Chief of Staff agent — managing follow-ups, clients, sprints, team performance, meetings, emails, and meeting intelligence.

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌────────────┐
│   Frontend       │────▶│    Backend        │────▶│ PostgreSQL │
│   Next.js 14     │     │    FastAPI        │     │   pg:16    │
│   :3000          │◀────│    :8000          │◀────│   :5433    │
│                  │ WS  │                   │     │  (Docker)  │
└─────────────────┘     └────────┬──────────┘     └────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   OpenClaw Gateway      │
                    │   :18789                │
                    │   AI Agent Execution    │
                    │                         │
                    │   ┌─────────────────┐   │
                    │   │ Workspace JSONs │   │
                    │   │ ~/.openclaw/    │   │
                    │   └─────────────────┘   │
                    └─────────────────────────┘
```

### Data Flow

1. **OpenClaw** (AI agent) writes/updates JSON files in `~/.openclaw/workspace/data/`
2. **Backend** reads those JSON files via `cos_reader.py` and syncs them into PostgreSQL
3. **Real-time updates** — a file watcher polls the workspace every 2 seconds; changes broadcast to frontend via WebSocket
4. **Execution** — when users click action buttons, the backend delegates to OpenClaw via the gateway's `/v1/responses` API
5. **Frontend** renders data and provides the UI for all operations

### OpenClaw Integration

The dashboard delegates all execution tasks to OpenClaw instead of handling them directly:

| Action | Old Way | New Way |
|--------|---------|---------|
| Send overdue alerts | Backend calls SMTP directly | Backend → OpenClaw → notification-router skill |
| Send meeting notes | Backend calls Fireflies API + SMTP | Backend → OpenClaw → fireflies-notetaker + email-sender |
| Fetch transcripts | Backend calls Fireflies GraphQL | Backend → OpenClaw → fireflies-notetaker skill |
| Generate meeting insights | N/A | Backend → OpenClaw → AI analysis |

---

## Tech Stack

| Component | Technology | Port |
|-----------|-----------|------|
| Frontend | Next.js 14, React 18, TypeScript, Tailwind CSS, Recharts | 3000 |
| Backend | FastAPI, SQLAlchemy, Pydantic, httpx, WebSockets | 8000 |
| Database | PostgreSQL 16 (Docker) | 5433 |
| AI Agent | OpenClaw Gateway (token auth) | 18789 |

---

## Project Structure

```
frontend-design-cos/
├── docker-compose.yml          # PostgreSQL only
├── README.md
│
├── backend/
│   ├── main.py                 # FastAPI app, WebSocket, auto-email scheduler
│   ├── gateway.py              # OpenClaw gateway client (httpx async)
│   ├── database.py             # SQLAlchemy engine + session
│   ├── models.py               # ORM models (TeamMember, Followup, Client, Sprint, etc.)
│   ├── schemas.py              # Pydantic schemas
│   ├── cos_reader.py           # Reads OpenClaw workspace JSON files
│   ├── seed.py                 # Database seeding from workspace
│   ├── requirements.txt
│   ├── .env                    # SMTP, Fireflies, OpenClaw credentials
│   └── routers/
│       ├── pulse.py            # PULSE board stats + team overview
│       ├── followups.py        # Follow-up CRUD
│       ├── clients.py          # Client management
│       ├── sprint.py           # Sprint tracking + updates
│       ├── performance.py      # Team performance reports
│       ├── briefing.py         # Morning briefing + EOD summary
│       ├── email.py            # Email sending (AWS SES)
│       ├── fireflies.py        # Fireflies.ai integration (via OpenClaw)
│       ├── meetings.py         # Calendar meetings
│       ├── vault.py            # Secret vault
│       ├── finance.py          # Financial data
│       ├── intel.py            # Intelligence/insights
│       ├── gmail.py            # Gmail integration
│       ├── execute.py          # OpenClaw execution router (/api/execute)
│       └── taskflow.py         # TaskFlow management
│
└── frontend/
    ├── app/
    │   ├── layout.tsx          # Root layout (Header + Sidebar + Main)
    │   ├── page.tsx            # PULSE Board (homepage)
    │   ├── followups/page.tsx  # Follow-ups (Kanban + List)
    │   ├── clients/page.tsx    # Clients & Pipeline
    │   ├── sprint/page.tsx     # Sprint Management
    │   ├── performance/page.tsx # Team Performance
    │   ├── meetings/page.tsx   # Meetings
    │   ├── email/page.tsx      # Email Sender + Automations
    │   ├── fireflies/page.tsx  # Fireflies (rebuilt with OpenClaw)
    │   ├── vault/page.tsx      # Vault
    │   ├── finance/page.tsx    # Finance
    │   ├── intel/page.tsx      # Intel
    │   └── taskflow/page.tsx   # TaskFlow
    │
    └── components/
        ├── Header.tsx          # Global header (Live + OpenClaw indicators)
        ├── Sidebar.tsx         # Navigation sidebar
        ├── StatCard.tsx        # Metric card component
        ├── FollowupCard.tsx    # Follow-up card (Kanban)
        ├── ClientCard.tsx      # Client card
        ├── TeamMember.tsx      # Team member card
        ├── HealthBadge.tsx     # Health score badge
        ├── BurndownChart.tsx   # Sprint burndown (Recharts)
        ├── PerformanceChart.tsx # Performance trends
        └── useWebSocket.ts    # Real-time WebSocket hook
```

---

## Setup & Running

### Prerequisites

- Node.js 20+
- Python 3.11+
- Docker & Docker Compose
- OpenClaw gateway running on port 18789

### 1. Database (Docker)

```bash
docker compose up db -d
```

PostgreSQL runs on port **5433** (5432 is reserved for other services).

### 2. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Seed the database
python seed.py

# Start the server
export $(grep -v '^#' .env | xargs)
uvicorn main:app --reload --port 8000
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs on `http://localhost:3000`.

### 4. OpenClaw Gateway

Ensure the OpenClaw gateway is running:

```bash
openclaw gateway status
```

If not running:

```bash
openclaw gateway --port 18789
```

---

## Environment Variables

### `backend/.env`

```env
# AWS SES (Email)
SMTP_HOST=email-smtp.us-east-1.amazonaws.com
SMTP_PORT=587
SMTP_USER_NAME=<AWS SES SMTP username>
SMTP_PASSWORD=<AWS SES SMTP password>
SMTP_FROM=connect@customerconnect.site

# Fireflies.ai
FIREFLIES_API_KEY=<Fireflies API key>

# Slack
SLACK_WEBHOOK_URL=<Slack webhook URL>

# OpenClaw Gateway
OPENCLAW_GATEWAY_URL=http://localhost:18789
OPENCLAW_GATEWAY_TOKEN=<gateway auth token>
```

---

## Pages & Features

### PULSE Board (`/`)

The main dashboard showing real-time operational status:
- Morning briefing with today's highlights
- Stat cards: Active Tasks, Done Today, Overdue, Team Reliability
- Team member cards with task assignments, scores, and health indicators
- Real-time WebSocket updates

### Follow-ups (`/followups`)

Track commitments and action items:
- **Kanban view**: Open → In Progress → Resolved columns
- **List view**: Sortable table
- **Filters**: By assignee and priority (P1/P2/P3)
- **Create**: Modal form with what, who, due date, priority
- **Resolve**: One-click resolution with timestamp

### Clients (`/clients`)

Client relationship management:
- Client cards with health scores (0-100), sentiment, pipeline phase
- At-risk alerts for clients with health < 60
- Contact information and interaction history

### Sprint (`/sprint`)

Sprint tracking and team updates:
- Sprint status card with Work Done % vs Time Elapsed %
- Burndown chart (Recharts)
- Sprint goals
- Weekly team updates with mood tracking
- **Send via OpenClaw**: Slack, Email, or both — delegated to OpenClaw agent

### Performance (`/performance`)

Team performance reports:
- Biweekly performance snapshots
- Completion rate, on-time rate, overdue count
- Flagged performers (low scores)
- Individual performance history

### Email (`/email`)

**Compose & Send tab:**
- Markdown editor with branded NeuralEDGE HTML preview
- 6 email templates (Follow-up Reminder, Client Status, Meeting Summary, etc.)
- Send to individual or all team members
- AWS SES integration

**Automations tab:**
- **OpenClaw Gateway status** indicator (Connected/Disconnected)
- **Auto-Schedule**: 09:00 Morning Briefing, 10:00 Overdue Alerts, 18:00 EOD Summary
- **Manual Triggers** (execute via OpenClaw):
  - Send Overdue Alerts (P0 routing)
  - Daily Digest to CEO
  - Sprint Status to Team
  - P1 Follow-up Reminders
- Per-button execution state ("Executing..." only on the clicked button)
- Recent Activity log

### Fireflies (`/fireflies`)

Meeting transcript management — fully rebuilt with OpenClaw integration:

**Header:**
- Date range picker (From/To + Filter + Clear)
- Gateway status indicator
- Stats row: Total Meetings, Action Items, Avg Duration, This Week

**4-Tab System:**
- **Timeline**: Meetings grouped by date with visual timeline, duration bars, attendee avatar circles
- **Transcripts**: Enhanced list with duration visualization and attendee initials
- **Action Items**: Checkbox-style items grouped by meeting
- **Search**: Keyword search with results via OpenClaw

**Detail Panel:**
- Title, date, duration, host
- Colored attendee avatar circles with initials
- Bullet summary, Action items (red), Outline (indigo), Keywords (purple)
- **Transcript viewer**: Collapsible, speaker-colored with MM:SS timestamps, paginated (50 at a time)
- **Export**: Markdown (.md) and JSON (.json) downloads
- **AI Meeting Intelligence**: "Generate Insights" button → OpenClaw analyzes the transcript:
  - Executive summary
  - Decisions (green)
  - Risks (red)
  - Notable quotes (yellow blockquotes)
  - Sentiment badge with score (1-10)
  - Elapsed timer during analysis
  - Cached results (instant on re-select)
  - Refresh button to regenerate
  - Error handling with Retry button
- Send Notes to Team / Individual via OpenClaw

**Loading States:**
- Skeleton cards (pulsing gray bars) for transcript list, actions, timeline
- Detail panel skeleton with avatar placeholders
- Error banners with Retry button and context text

### Meetings (`/meetings`)
Today's calendar with meeting details and attendees.

### Vault (`/vault`)
Secret vault entries from the workspace.

### Finance (`/finance`)
Financial metrics and reporting.

### Intel (`/intel`)
Intelligence and insights aggregation.

### TaskFlow (`/taskflow`)
Task management interface.

---

## API Endpoints

### Core

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Health check |
| WS | `/ws/live` | Real-time WebSocket updates |

### Execute (OpenClaw)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/execute` | Execute action via OpenClaw gateway |
| GET | `/api/gateway/status` | Check OpenClaw gateway connectivity |

**Available actions** (15 total):

| Action Key | Description |
|------------|-------------|
| `send_overdue_alerts` | P0 overdue alert emails |
| `daily_digest_ceo` | Morning briefing to CEO |
| `sprint_status_team` | Sprint update to all team |
| `p1_followup_reminders` | P1 follow-up reminders |
| `send_email` | Send single email |
| `send_multi_email` | Send to multiple recipients |
| `create_followup` | Create follow-up via OpenClaw |
| `resolve_followup` | Resolve follow-up |
| `send_meeting_notes` | Send Fireflies notes to recipients |
| `send_sprint_updates` | Send sprint updates via channel |
| `list_transcripts` | List Fireflies transcripts |
| `get_transcript` | Get full transcript detail |
| `search_transcripts` | Search transcripts by keyword |
| `get_action_items` | Get action items from meetings |
| `analyze_meeting` | AI analysis of a meeting |

### Pulse

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/pulse` | Full board with team stats |
| GET | `/api/pulse/summary` | Quick stats |
| GET | `/api/pulse/person/{slug}` | Individual member detail |

### Follow-ups

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/followups` | List all (with filters) |
| POST | `/api/followups` | Create new |
| PUT | `/api/followups/{id}` | Update |
| PUT | `/api/followups/{id}/resolve` | Mark resolved |

### Clients

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/clients` | List all |
| GET | `/api/clients/health` | At-risk clients |
| POST | `/api/clients` | Create |
| PUT | `/api/clients/{slug}` | Update |

### Sprint

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sprint` | Current sprint |
| GET | `/api/sprint/burndown` | Burndown data |
| POST | `/api/sprint/updates` | Create update |
| POST | `/api/sprint/updates/send` | Send via Slack/Email |

### Email

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/email/send` | Send single email |
| POST | `/api/email/send-multi` | Send to multiple |
| POST | `/api/email/notify` | Priority-routed notification |
| POST | `/api/email/preview` | Preview HTML |
| GET | `/api/email/config` | SMTP config status |
| GET | `/api/email/contacts` | Team contacts |
| GET | `/api/email/schedule` | Auto-email schedule |

### Fireflies (via OpenClaw)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/fireflies/list` | List transcripts |
| GET | `/api/fireflies/transcript/{id}` | Full transcript detail |
| GET | `/api/fireflies/actions` | Action items from meetings |
| GET | `/api/fireflies/search` | Search by keyword |
| GET | `/api/fireflies/intelligence/{id}` | AI meeting analysis |
| GET | `/api/fireflies/config` | Gateway status |
| POST | `/api/fireflies/send-notes` | Email notes to recipients |
| POST | `/api/fireflies/send-notes-to-team` | Email notes to all team |

### Other

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/briefing/morning` | Morning briefing |
| GET | `/api/briefing/eod` | EOD summary |
| GET | `/api/performance/report` | Performance report |
| GET | `/api/meetings/today` | Today's meetings |

---

## OpenClaw Skills

The dashboard uses these OpenClaw workspace skills:

| Skill | Path | Purpose |
|-------|------|---------|
| `email-sender` | `skills/email-sender/` | SMTP email via AWS SES |
| `notification-router` | `skills/notification-router/` | Priority-based routing |
| `follow-up-tracker` | `skills/follow-up-tracker/` | Follow-up lifecycle |
| `fireflies-notetaker` | `skills/fireflies-notetaker/` | Transcript fetching & analysis |
| `sprint-tracker` | `skills/sprint-tracker/` | Sprint management |
| `slack-integration` | `skills/slack-integration/` | Slack messaging |
| `dashboard-sync` | `skills/dashboard-sync/` | Sync workspace → PostgreSQL |

### Dashboard Sync Skill

Keeps the PostgreSQL database in sync with workspace JSON files:

```bash
# After creating a follow-up
python3 ~/.openclaw/workspace/scripts/dashboard/sync.py followup create \
  --data '{"what": "Review invoice", "who": "mansi", "priority": "P2"}'

# After resolving
python3 ~/.openclaw/workspace/scripts/dashboard/sync.py followup resolve --id FU-0008

# Check dashboard status
python3 ~/.openclaw/workspace/scripts/dashboard/sync.py status
```

---

## Real-time Updates

The backend watches `~/.openclaw/workspace/data/` for file changes every 2 seconds. When OpenClaw creates or modifies a JSON file, the change is:

1. Detected by the file watcher
2. Classified by type (followup_update, client_update, sprint_update, etc.)
3. Broadcast to all connected WebSocket clients
4. Frontend re-renders the affected components

---

## Auto-Email Schedule

Three automated emails run daily (IST timezone):

| Time | Name | Recipient | Content |
|------|------|-----------|---------|
| 09:00 | Morning Briefing | CEO (yatharth@synlex.tech) | Active tasks, overdue items, meetings, sprint status |
| 10:00 | Overdue Alerts | Per-person (notification routes) | Individual overdue follow-ups |
| 18:00 | EOD Summary | CEO (yatharth@synlex.tech) | Resolved, open, overdue counts |

---

## Database Schema

| Table | Purpose |
|-------|---------|
| `TeamMember` | Team roster (name, role, email, Slack ID) |
| `Followup` | Tasks/action items with priority + status |
| `Client` | Client health scores, sentiment, pipeline |
| `ClientContact` | Client contact details |
| `Sprint` | Sprint goals, dates, status |
| `SprintUpdate` | Weekly team check-ins with mood |
| `PerformanceSnapshot` | Biweekly scores and metrics |
| `BoardSnapshot` | Daily board state (JSONB) |
| `NotificationLog` | Email/Slack send history |

---

## Testing

### Quick Smoke Test

```bash
# All pages load
for page in / /followups /clients /sprint /email /fireflies; do
  curl -s -o /dev/null -w "%{http_code} $page\n" http://localhost:3000$page
done

# Gateway connected
curl -s http://localhost:8000/api/gateway/status

# Execute endpoint
curl -s -X POST http://localhost:8000/api/execute \
  -H "Content-Type: application/json" \
  -d '{"action": "send_overdue_alerts"}'
```

### Unit Tests

```bash
cd backend && source venv/bin/activate
python /tmp/test_unit_all.py     # 20 tests — JSON parser + normalizers
```

### Full Test Suite (Playwright)

```bash
# Install Playwright
cd ~/.claude/plugins/cache/playwright-skill/playwright-skill/4.1.0/skills/playwright-skill
npm run setup

# Run tests
node run.js /tmp/playwright-full-live.js   # 40 tests across 5 levels
```

### Dashboard Sync Tests

```bash
python /tmp/test_dashboard_sync.py    # 33 tests
```

---

## License

Proprietary — NeuralEDGE. All rights reserved.
