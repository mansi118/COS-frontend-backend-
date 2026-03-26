import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  team_members: defineTable({
    slug: v.string(),
    name: v.string(),
    role: v.optional(v.string()),
    emoji: v.optional(v.string()),
    slack_id: v.optional(v.string()),
    email: v.optional(v.string()),
    created_at: v.optional(v.string()),
  }).index("by_slug", ["slug"]),

  followups: defineTable({
    fu_id: v.string(),
    what: v.string(),
    who: v.optional(v.string()),
    due: v.optional(v.string()),
    priority: v.optional(v.string()),
    status: v.string(),
    source: v.optional(v.string()),
    source_id: v.optional(v.string()),
    notes: v.optional(v.string()),
    checklist: v.optional(v.array(v.object({
      text: v.string(),
      priority: v.string(),
      completed: v.boolean(),
    }))),
    created_at: v.optional(v.string()),
    updated_at: v.optional(v.string()),
    resolved_at: v.optional(v.string()),
  }).index("by_fu_id", ["fu_id"])
    .index("by_who", ["who"])
    .index("by_status", ["status"])
    .index("by_source", ["source"]),

  clients: defineTable({
    slug: v.string(),
    name: v.string(),
    industry: v.optional(v.string()),
    phase: v.optional(v.string()),
    contract_value: v.optional(v.string()),
    health_score: v.optional(v.number()),
    last_interaction: v.optional(v.string()),
    last_interaction_type: v.optional(v.string()),
    sentiment: v.optional(v.string()),
    overdue_invoices: v.optional(v.number()),
    deliverables_on_track: v.optional(v.boolean()),
    created_at: v.optional(v.string()),
  }).index("by_slug", ["slug"]),

  client_contacts: defineTable({
    client_slug: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    role: v.optional(v.string()),
  }).index("by_client", ["client_slug"]),

  sprints: defineTable({
    name: v.string(),
    start_date: v.string(),
    end_date: v.string(),
    goals: v.optional(v.array(v.string())),
    status: v.string(),
    created_at: v.optional(v.string()),
    closed_at: v.optional(v.string()),
  }).index("by_status", ["status"]),

  sprint_updates: defineTable({
    sprint_id: v.id("sprints"),
    person: v.string(),
    week_label: v.optional(v.string()),
    accomplished: v.string(),
    blockers: v.optional(v.string()),
    plan_next_week: v.optional(v.string()),
    mood: v.optional(v.string()),
    notified_slack: v.optional(v.boolean()),
    notified_email: v.optional(v.boolean()),
    created_at: v.optional(v.string()),
  }).index("by_sprint", ["sprint_id"])
    .index("by_person", ["person"])
    .index("by_week", ["week_label"]),

  notification_logs: defineTable({
    update_id: v.optional(v.id("sprint_updates")),
    channel: v.string(),
    recipient: v.string(),
    status: v.string(),
    sent_at: v.optional(v.string()),
  }),

  performance_snapshots: defineTable({
    person: v.string(),
    period: v.optional(v.string()),
    score: v.optional(v.number()),
    rating: v.optional(v.string()),
    total_assigned: v.optional(v.number()),
    total_completed: v.optional(v.number()),
    completion_rate: v.optional(v.number()),
    on_time_rate: v.optional(v.number()),
    overdue_count: v.optional(v.number()),
    evaluated_at: v.optional(v.string()),
  }).index("by_person", ["person"]),

  voice_updates: defineTable({
    vu_id: v.string(),
    who: v.string(),
    type: v.string(),
    audio_url: v.optional(v.string()),
    audio_format: v.optional(v.string()),
    duration_sec: v.optional(v.number()),
    transcript: v.optional(v.string()),
    summary: v.optional(v.string()),
    routed_to: v.optional(v.array(v.object({
      type: v.string(),
      id: v.string(),
    }))),
    listened_by: v.optional(v.array(v.string())),
    priority: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    created_at: v.optional(v.string()),
    updated_at: v.optional(v.string()),
  }).index("by_vu_id", ["vu_id"])
    .index("by_who", ["who"])
    .index("by_type", ["type"]),

  board_snapshots: defineTable({
    date: v.string(),
    data: v.any(),
    created_at: v.optional(v.string()),
  }).index("by_date", ["date"]),

  standups: defineTable({
    person: v.string(),
    name: v.optional(v.string()),
    date: v.string(),
    done: v.optional(v.string()),
    doing: v.optional(v.string()),
    blockers: v.optional(v.string()),
    mood: v.optional(v.string()),
    highlights: v.optional(v.array(v.string())),
    linked_tasks: v.optional(v.array(v.string())),
    doing_priorities: v.optional(v.any()),
    created_at: v.optional(v.string()),
    updated_at: v.optional(v.string()),
  }).index("by_person", ["person"])
    .index("by_date", ["date"])
    .index("by_person_and_date", ["person", "date"]),

  tasks: defineTable({
    task_id: v.string(),
    title: v.string(),
    notes: v.optional(v.string()),
    status: v.string(),
    when_date: v.optional(v.string()),
    deadline: v.optional(v.string()),
    is_today: v.optional(v.boolean()),
    is_someday: v.optional(v.boolean()),
    project_id: v.optional(v.string()),
    area_id: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    priority_hint: v.optional(v.string()),
    checklist_items: v.optional(v.array(v.object({
      title: v.string(),
      is_completed: v.boolean(),
    }))),
    owner: v.optional(v.string()),
    source: v.optional(v.string()),
    created: v.optional(v.string()),
    updated: v.optional(v.string()),
    completed_at: v.optional(v.string()),
    trashed_at: v.optional(v.string()),
  }).index("by_task_id", ["task_id"])
    .index("by_status", ["status"])
    .index("by_owner", ["owner"])
    .index("by_project", ["project_id"]),

  taskflow_projects: defineTable({
    project_id: v.string(),
    name: v.string(),
    color: v.optional(v.string()),
    status: v.optional(v.string()),
    notes: v.optional(v.string()),
    area_id: v.optional(v.string()),
    deadline: v.optional(v.string()),
  }).index("by_project_id", ["project_id"]),

  taskflow_areas: defineTable({
    area_id: v.string(),
    name: v.string(),
    color: v.optional(v.string()),
    icon: v.optional(v.string()),
  }).index("by_area_id", ["area_id"]),

  taskflow_tags: defineTable({
    tag_id: v.string(),
    name: v.string(),
    slug: v.optional(v.string()),
    color: v.optional(v.string()),
  }).index("by_tag_id", ["tag_id"]),

  vexa_meetings: defineTable({
    title: v.string(),
    platform: v.string(),
    meeting_id: v.string(),
    status: v.string(),
    start_time: v.optional(v.string()),
    end_time: v.optional(v.string()),
    duration_sec: v.optional(v.number()),
    participants: v.optional(v.array(v.string())),
    transcript_available: v.optional(v.boolean()),
    intelligence_done: v.optional(v.boolean()),
    vexa_id: v.optional(v.number()),
    created_at: v.optional(v.string()),
  }).index("by_meeting_id", ["meeting_id"])
    .index("by_status", ["status"])
    .index("by_platform", ["platform"]),
});
