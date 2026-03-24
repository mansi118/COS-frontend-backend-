# NeuralEDGE PULSE Command Center — System Design

## 1. System Overview

The PULSE Command Center is a **Chief of Staff Dashboard** — a real-time operational command center that orchestrates team operations through AI agent execution (OpenClaw), multi-channel communications, task management, meeting intelligence, and automated workflows.

```
┌─────────────────────────────────────────────────────────────────┐
│                    PULSE Command Center                         │
│                                                                 │
│  Frontend (Next.js 14)  ←→  Backend (FastAPI)  ←→  OpenClaw    │
│       :3000                    :8000                 :18789     │
│                                  ↕                              │
│                           PostgreSQL :5433                      │
│                           (Docker)                              │
│                                  ↕                              │
│                    CoS Workspace (JSON files)                   │
│                  ~/.openclaw/workspace/data/                    │
└─────────────────────────────────────────────────────────────────┘
```

## 2. Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────────┐
│   Frontend   │     │   Backend    │     │     OpenClaw         │
│  (Next.js)   │────→│  (FastAPI)   │────→│  Gateway :18789      │
│    :3000     │←────│    :8000     │←────│                      │
│              │     │              │     │  Skills:             │
│ • PULSE Board│     │ • REST APIs  │     │  • standup-poster    │
│ • Updates    │     │ • WebSocket  │     │  • follow-up-tracker │
│ • Follow-ups │     │ • Scheduler  │     │  • sprint-tracker    │
│ • Sprint     │     │ • Fanout     │     │  • dashboard-sync    │
│ • TaskFlow   │     │              │     │  • email-sender      │
│ • Fireflies  │     │              │     │  • notification-router│
│ • Meetings   │     │              │     │  • fireflies-notetaker│
│ • Comms      │     │              │     │  • 30+ more skills   │
│ • Vault      │     │              │     │                      │
└──────┬───────┘     └──────┬───────┘     └──────────┬───────────┘
       │                    │                         │
       │              ┌─────┴─────┐            ┌──────┴──────┐
       │              │           │            │             │
       │         ┌────┴───┐  ┌───┴────┐  ┌────┴───┐  ┌─────┴────┐
       │         │PostgreSQL│  │CoS JSON│  │CLI     │  │Workspace │
       │         │  :5433  │  │ files  │  │Scripts │  │  data/   │
       │         └─────────┘  └────────┘  └────────┘  └──────────┘
       │
  WebSocket (/ws/live)
  Auto-reconnect 3s
```

## 3. Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | Next.js 14, React 18, TypeScript | UI framework |
| **Styling** | Tailwind CSS 3.4 | Dark theme dashboard |
| **Charts** | Recharts | Burndown, sparklines, performance |
| **Backend** | FastAPI, Python 3.12 | REST API + WebSocket |
| **ORM** | SQLAlchemy 2.0 | Database access |
| **Database** | PostgreSQL 16 (Docker) | Persistent storage (fallback) |
| **Primary Storage** | JSON files (CoS workspace) | Source of truth |
| **AI Agent** | OpenClaw Gateway | Natural language task execution |
| **Email** | AWS SES (SMTP) | Email notifications |
| **Meetings** | Fireflies.ai GraphQL API | Meeting transcripts + action items |
| **Messaging** | Slack (Bot + Webhook), Twilio (WhatsApp) | Multi-channel comms |
| **Real-time** | WebSocket + File watcher (2s polling) | Live updates |

## 4. Data Flow Architecture

### 4.1 Write Path (User Action → Storage)

```
Frontend Button Click
    ↓
POST /api/execute {action, args}
    ↓
Backend: ACTION_MAP lookup → fill template → escape braces
    ↓
OpenClaw Gateway: POST /v1/responses {model, input, stream}
    ↓
OpenClaw Agent: processes natural language instruction
    ↓
CLI Script: python3 scripts/{skill}/script.py
    ↓
Backend API: POST /api/{resource}
    ↓
Dual Write:
  ├── CoS JSON: ~/.openclaw/workspace/data/{resource}/{id}.json
  └── PostgreSQL: INSERT INTO {table}
    ↓
File Watcher detects change (2s poll)
    ↓
WebSocket broadcast: {type: "{resource}_update", file, data}
    ↓
Frontend: Smart partial refresh (1-3 endpoints, not all 10)
```

### 4.2 Read Path (Frontend ← Backend ← Storage)

```
Frontend: GET /api/{resource}
    ↓
Backend: cos_reader.get_{resource}()
    ↓
Primary: Read from CoS workspace JSON files
    ↓
If empty → Fallback: Query PostgreSQL
    ↓
Enrich: Resolve who_name from roster, add computed fields
    ↓
Return JSON response
    ↓
Frontend: setState → render
```

### 4.3 Standup Fanout (Auto-creation)

```
POST /api/standups {person, done, doing, blockers, mood}
    ↓
standup_local.post_standup() → JSON file
    ↓
standup_fanout.py:
  ├── parse_doing_items(doing) → items with auto-priority
  ├── create_followup_from_standup() → FU-NNNN.json + DB
  ├── create_task_from_standup() → TF-NNNN.json
  ├── suggest_resolutions(done) → fuzzy match vs open FUs
  └── Link back: standup.linked_tasks = [FU-ID, TF-ID]
    ↓
WebSocket → Frontend refreshes
```

### 4.4 Fireflies Auto-Extract

```
Frontend /fireflies page mount
    ↓
POST /api/fireflies/auto-extract
    ↓
GraphQL: query Fireflies API (last 30 days)
    ↓
For each transcript with action_items:
  ├── Idempotency check (source_id = transcript_id)
  ├── create_followups_from_meeting() → FU with checklist
  └── create_task in TaskFlow
    ↓
Return: {processed, skipped, extracted_transcript_ids}
```

## 5. Frontend Pages

| Page | Route | Data Sources | OpenClaw Actions |
|------|-------|-------------|-----------------|
| **PULSE Board** | `/` | pulse, briefing, meetings, standups, sprint, clients, activity, alerts, CEO summary, trends | — |
| **Updates** | `/updates` | standups/today, standups/stats, followups | post_standup, update_standup, send_standup_reminder |
| **Follow-ups** | `/followups` | followups, tasks | create_followup, edit_followup, delete_followup, update_followup_status, toggle_checklist_item |
| **Sprint** | `/sprint` | sprint, burndown, updates/by-week, standup-activity | send_sprint_updates, sprint_status, sprint_start, sprint_close |
| **TaskFlow** | `/taskflow` | taskflow/tasks, summary, projects, analytics, briefing | create_task, edit_task, delete_task |
| **Fireflies** | `/fireflies` | fireflies/list, transcript, actions, search, intelligence | send_meeting_notes, analyze_meeting, auto-extract |
| **Meetings** | `/meetings` | meetings/today | — |
| **Comms** | `/comms` | email/config, whatsapp/config, slack/config, contacts | send_email, automations |
| **Vault** | `/vault` | vault entries | — |
| **Performance** | `/performance` | performance/report, flag, history | — |
| **Clients** | `/clients` | clients, clients/health | — |

## 6. Backend API Structure

### 6.1 Core APIs

```
/api/pulse                    GET    Main dashboard data
/api/pulse/summary            GET    Quick summary
/api/pulse/person/{slug}      GET    Individual member
/api/pulse/trends             GET    7-day sparkline data
/api/pulse/activity            GET    Recent events feed
/api/pulse/alerts             GET    Critical + warning alerts
/api/pulse/ceo-summary        GET    Executive one-liner
```

### 6.2 Follow-ups (Full CRUD via OpenClaw)

```
/api/followups                GET    List (filters: status, who, priority, source)
/api/followups                POST   Create (dual-write: JSON + DB)
/api/followups/{fu_id}        PUT    Update fields
/api/followups/{fu_id}/resolve PUT   Mark resolved
/api/followups/{fu_id}/checklist/{i}/toggle PUT  Toggle checklist item
/api/followups/{fu_id}        DELETE Delete permanently
/api/followups/by-source      GET    Filter by source
/api/followups/remind         GET    Overdue + due today
```

### 6.3 Standups

```
/api/standups                 POST   Post standup (triggers fanout)
/api/standups/{person}        PUT    Update standup
/api/standups/today           GET    Today's standups
/api/standups/{date}          GET    By date
/api/standups/stats           GET    Stats (posted, missing, mood, streaks)
/api/standups/summary         GET    Compact summary for PULSE
/api/standups/person/{slug}   GET    Person history (14 days)
/api/standups/suggestions/{person} GET Resolution suggestions
/api/standups/{person}/priorities PUT  Update doing item priorities
/api/standups/resolve-suggestion POST Confirm resolution
/api/standups/remind          POST   Send reminders (Slack + WhatsApp)
```

### 6.4 Sprint

```
/api/sprint                   GET    Current sprint + metrics
/api/sprint                   POST   Create new sprint
/api/sprint/burndown          GET    Real burndown data
/api/sprint/standup-activity  GET    Daily standup data across sprint
/api/sprint/updates           GET    List updates
/api/sprint/updates           POST   Create update
/api/sprint/updates/by-week   GET    Grouped by week
/api/sprint/updates/auto-generate POST Auto-generate from standups
/api/sprint/updates/send      POST   Send via Slack/Email
```

### 6.5 TaskFlow

```
/api/taskflow/tasks           GET    List by view (today/inbox/upcoming/...)
/api/taskflow/tasks           POST   Create task
/api/taskflow/tasks/{id}      PUT    Update task
/api/taskflow/tasks/{id}/complete    POST  Mark completed
/api/taskflow/tasks/{id}/uncomplete  POST  Revert to active
/api/taskflow/tasks/{id}/trash       POST  Move to trash
/api/taskflow/tasks/{id}/restore     POST  Restore
/api/taskflow/tasks/{id}/checklist/{i}/toggle PUT Toggle checklist
/api/taskflow/summary         GET    Daily stats
/api/taskflow/projects        GET/POST  Projects CRUD
/api/taskflow/analytics/*     GET    Health, workload, risks, velocity
/api/taskflow/briefing/*      GET    Daily + team briefing
/api/taskflow/notify/*        POST   Email notifications
```

### 6.6 OpenClaw Execute

```
/api/execute                  POST   Execute action via OpenClaw gateway
/api/gateway/status           GET    Check gateway connectivity
```

### 6.7 Fireflies

```
/api/fireflies/list           GET    List transcripts
/api/fireflies/transcript/{id} GET   Full transcript detail
/api/fireflies/actions        GET    Action items from meetings
/api/fireflies/search         GET    Keyword search
/api/fireflies/intelligence/{id} GET AI analysis
/api/fireflies/auto-extract   POST   Auto-create follow-ups from meetings
/api/fireflies/send-notes     POST   Email meeting notes
/api/fireflies/config         GET    API status
```

## 7. OpenClaw Integration

### 7.1 ACTION_MAP (Natural Language Templates)

```python
ACTION_MAP = {
    # Email
    "send_email": "Send an email to {to} with subject '{subject}'. Body:\n{body}",
    "send_multi_email": "Send an email to: {to}. Subject: '{subject}'. Body:\n{body}",
    "send_overdue_alerts": "Send P0 overdue alert emails...",
    "daily_digest_ceo": "Send the daily morning briefing...",
    "sprint_status_team": "Send sprint status update...",
    "p1_followup_reminders": "Send P1 follow-up reminders...",

    # Follow-ups
    "create_followup": "Create a new follow-up item: {what}. Assign to {who}...",
    "edit_followup": "Update follow-up {fu_id}. Set: what={what}, who={who}...",
    "delete_followup": "Delete follow-up {fu_id} permanently.",
    "resolve_followup": "Resolve follow-up {fu_id}...",
    "update_followup_status": "Update the status of follow-up {fu_id} to {status}.",
    "toggle_checklist_item": "Toggle checklist item {item_index} on follow-up {fu_id}...",

    # Standups
    "post_standup": "Post a daily standup update for {person}...",
    "update_standup": "Update today's standup for {person}...",
    "send_standup_reminder": "Send standup reminders...",

    # Sprint
    "sprint_status": "Get the current sprint status...",
    "sprint_start": "Start a new sprint named {name} with goals: {goals}.",
    "sprint_close": "Close the current sprint...",
    "send_sprint_updates": "Send sprint updates for week '{week}' via {channel}.",

    # Tasks
    "create_task": "Create a new task: {title}. Assign to {owner}...",
    "edit_task": "Update task {task_id}. Set: title={title}...",
    "delete_task": "Delete task {task_id} permanently.",

    # Fireflies
    "list_transcripts": "List the {limit} most recent Fireflies transcripts...",
    "get_transcript": "Get the full Fireflies transcript with ID {transcript_id}...",
    "search_transcripts": "Search Fireflies transcripts for '{keyword}'...",
    "get_action_items": "Get action items from {limit} recent transcripts...",
    "analyze_meeting": "Analyze transcript {transcript_id}...",
    "send_meeting_notes": "Email meeting notes for {transcript_id}...",
}
```

### 7.2 Gateway Client

```python
# gateway.py
async def execute(instruction: str) -> dict:
    response = await client.post("/v1/responses", json={
        "model": "openclaw:main",
        "input": instruction,   # Natural language from ACTION_MAP
        "stream": False,
    })
    return {"success": True, "result": extracted_text, "via": "openclaw"}
```

### 7.3 OpenClaw Skills (in workspace)

```
~/.openclaw/workspace/skills/
├── standup-poster/SKILL.md        # Post standups via dashboard API
├── follow-up-tracker/SKILL.md     # Track commitments to resolution
├── sprint-tracker/SKILL.md        # Sprint progress + burndown
├── dashboard-sync/SKILL.md        # Sync workspace → PostgreSQL
├── email-sender/SKILL.md          # Send SMTP emails via AWS SES
├── notification-router/SKILL.md   # Route alerts by priority + channel
├── fireflies-notetaker/SKILL.md   # Fetch meeting transcripts
├── standup-autopilot/SKILL.md     # Auto: transcript → MOM → tasks
├── task-orchestration/SKILL.md    # Task lifecycle management
├── progress-board/SKILL.md        # PULSE board generation
└── 24+ more skills
```

### 7.4 CLI Scripts

```
~/.openclaw/workspace/scripts/
├── standup/post.py      # POST /api/standups
├── standup/collect.py   # Async standup via Slack DM
├── followups/followups.py # Full FU lifecycle CLI
├── sprint/sprint.py     # Sprint start/status/burndown/close
├── dashboard/sync.py    # Sync workspace → backend API
├── board/board.py       # PULSE board generation
├── email/smtp.py        # Send emails
├── notify/notify.py     # Notification router
├── fireflies/fireflies.py # Fireflies API client
├── telegram/telegram.py # Telegram cards/alerts
└── slack/slack.py       # Slack messaging
```

## 8. Database Schema

```sql
-- Team members
team_members (id, slug, name, role, emoji, slack_id, email, created_at)

-- Follow-ups (with checklist support)
followups (id, fu_id, what, who, due, priority, status, source, source_id,
           notes, checklist JSONB, created_at, updated_at, resolved_at)

-- Sprints
sprints (id, name, start_date, end_date, goals[], status, created_at, closed_at)

-- Sprint updates (weekly)
sprint_updates (id, sprint_id, person, week_label, accomplished, blockers,
                plan_next_week, mood, notified_slack, notified_email, created_at)

-- Clients
clients (id, slug, name, industry, phase, contract_value, health_score,
         last_interaction, sentiment, overdue_invoices, deliverables_on_track)

-- Performance snapshots
performance_snapshots (id, person, period, score, rating, total_assigned,
                       total_completed, completion_rate, on_time_rate, overdue_count)

-- Board snapshots (daily)
board_snapshots (id, date, data JSONB, created_at)

-- Notification log
notification_logs (id, update_id, channel, recipient, status, sent_at)
```

## 9. Real-Time Architecture

### 9.1 WebSocket Flow

```
Backend (main.py)                     Frontend (useWebSocket.ts)
    │                                       │
    │  watch_workspace()                    │
    │  (poll every 2s)                      │
    │       │                               │
    │  Detect file change                   │
    │       │                               │
    │  broadcast({                          │
    │    type: "followup_update",   ──────→ │  lastMessage received
    │    file: "FU-0013.json",              │       │
    │    data: {...},                       │  Smart partial refresh:
    │    deleted: false                     │    followup_update →
    │  })                                   │      refreshPulse()
    │                                       │      refreshAlerts()
    │                                       │      refreshCeo()
    │                                       │      refreshSprint()
    │                                       │      pushLiveEvent()
    │                                       │
    │                                       │  (NOT all 10 endpoints)
```

### 9.2 Smart Refresh Map

| WebSocket Type | Endpoints Refreshed | Count |
|---|---|---|
| `followup_update` | pulse, alerts, CEO, sprint | 4 |
| `standup_update` | standups | 1 |
| `client_update` | clients, alerts, CEO | 3 |
| `meeting_update` | meetings | 1 |
| `sprint_update` | sprint | 1 |
| `board_update` | pulse, trends | 2 |
| `task_update` | pulse | 1 |
| `performance_update` | pulse, CEO | 2 |
| unknown | pulse (fallback) | 1 |

### 9.3 Live Features

- **Activity Feed**: Events appended from WebSocket directly (no API re-fetch)
- **Stat Counters**: Animated number transitions (600ms ease-out cubic)
- **Team Card Pulse**: Indigo glow on affected member's card (1.5s)
- **Sprint Progress**: Updates immediately on followup_update

## 10. Data Storage

### 10.1 CoS Workspace (Primary — Source of Truth)

```
~/.openclaw/workspace/data/
├── follow-ups/
│   ├── FU-0001.json ... FU-NNNN.json
│   └── counter.json
├── standups/
│   └── YYYY-MM-DD/
│       ├── shivam.json
│       ├── mansi.json
│       └── naveen.json
├── sprint/
│   └── active.json
├── tasks/
│   ├── TF-0001.json ... TF-NNNN.json
│   └── counter.json
├── taskflow-meta/
│   ├── projects.json
│   ├── areas.json
│   └── tags.json
├── board/
│   └── snapshots/YYYY-MM-DD.json
├── clients/
├── config/
│   └── notification-routes.json
└── vault/
```

### 10.2 Follow-up JSON Structure

```json
{
  "id": "FU-0013",
  "what": "Daily commitments — Shivam Singh",
  "who": "shivam",
  "due": "2026-03-23",
  "source": "standup",
  "source_id": "shivam/2026-03-23",
  "priority": "P0",
  "status": "open",
  "checklist_items": [
    {"text": "Build dashboard widget", "priority": "P2", "completed": false},
    {"text": "Review PR #42", "priority": "P2", "completed": true},
    {"text": "BLOCKER: Waiting on AWS creds", "priority": "P0", "completed": false}
  ],
  "events": [
    {"timestamp": "...", "action": "created", "actor": "standup-fanout"},
    {"timestamp": "...", "action": "checklist_item_1_completed", "actor": "user-confirm"}
  ]
}
```

### 10.3 Standup JSON Structure

```json
{
  "person": "shivam",
  "name": "Shivam Singh",
  "date": "2026-03-23",
  "done": "Fixed auth bug. Deployed to staging.",
  "doing": "Build dashboard widget\nReview PR #42",
  "blockers": "Waiting on AWS creds from Ankit",
  "mood": "good",
  "highlights": ["Fixed auth bug", "Deployed to staging"],
  "linked_tasks": ["FU-0013", "TF-0003"],
  "doing_priorities": {"0": "P2", "1": "P2"},
  "created_at": "2026-03-23T09:03:09+05:30",
  "updated_at": "2026-03-23T09:03:09+05:30"
}
```

## 11. Cross-Feature Data Flow

```
                    ┌─────────┐
                    │Fireflies│
                    │   API   │
                    └────┬────┘
                         │ auto-extract
                         ▼
┌──────────┐     ┌──────────────┐     ┌──────────┐
│ Updates  │────→│  Follow-ups  │←────│ Meetings │
│ (standup)│     │ (FU-NNNN)   │     │(transcript)│
└──────────┘     └──────┬───────┘     └──────────┘
  fanout │              │
         │              ▼
         │       ┌──────────────┐
         └──────→│   TaskFlow   │
                 │ (TF-NNNN)   │
                 └──────┬───────┘
                        │
              ┌─────────┼─────────┐
              ▼         ▼         ▼
        ┌──────────┐ ┌────────┐ ┌──────┐
        │PULSE Board│ │Sprint  │ │Comms │
        │(dashboard)│ │(burndown)│ │(email)│
        └──────────┘ └────────┘ └──────┘
```

## 12. Auto-Scheduler (IST)

| Time | Job | What |
|------|-----|------|
| 00:01 | Pulse snapshot | Save daily board state to DB |
| 09:00 | Morning briefing | Email to CEO (yatharth@synlex.tech) |
| 10:00 | Overdue alerts | Per-person overdue emails |
| 11:00 | Standup reminders | Slack DM to missing members |
| 18:00 | EOD summary | Email to CEO |

## 13. Security Notes

- OpenClaw gateway uses Bearer token auth
- AWS SES credentials for email sending
- Fireflies API key for meeting data
- Slack Bot token for messaging
- Twilio credentials for WhatsApp
- PostgreSQL credentials (local Docker only)
- No user authentication on dashboard (local/internal use)
- Curly brace escaping on all OpenClaw template args (prevents injection)

## 14. Performance Characteristics

| Operation | Latency | Notes |
|-----------|---------|-------|
| Page load (initial) | 1-3s | 10 parallel API calls |
| WebSocket partial refresh | 200-500ms | 1-3 endpoints only |
| Checklist toggle | <500ms | Direct API (not OpenClaw) |
| OpenClaw action (create/edit) | 30-60s | Gateway processing time |
| Fireflies API query | 2-3s | Direct GraphQL |
| Auto-extract meetings | 5-15s | Depends on transcript count |
| Stat counter animation | 600ms | Client-side, ease-out cubic |

## 15. Deployment

```bash
# Database
docker compose up -d    # PostgreSQL on :5433

# Backend
cd backend
source venv/bin/activate
export $(grep -v '^#' .env | xargs)
uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Frontend
cd frontend
npm run dev              # Next.js on :3000

# OpenClaw (separate)
openclaw gateway start   # Gateway on :18789
```
