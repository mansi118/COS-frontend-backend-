import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const getActive = query({
  handler: async (ctx) => {
    return await ctx.db.query("sprints")
      .withIndex("by_status", q => q.eq("status", "active"))
      .first();
  },
});

export const list = query({
  handler: async (ctx) => {
    return await ctx.db.query("sprints").collect();
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    start_date: v.string(),
    end_date: v.string(),
    goals: v.optional(v.array(v.string())),
    status: v.string(),
    created_at: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Close existing active sprint
    const active = await ctx.db.query("sprints")
      .withIndex("by_status", q => q.eq("status", "active"))
      .first();
    if (active) await ctx.db.patch(active._id, { status: "closed", closed_at: new Date().toISOString() });
    return await ctx.db.insert("sprints", args);
  },
});

// Sprint updates
export const createUpdate = mutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("sprint_updates", args);
  },
});

export const getUpdatesByWeek = query({
  args: { sprint_id: v.id("sprints") },
  handler: async (ctx, args) => {
    return await ctx.db.query("sprint_updates")
      .withIndex("by_sprint", q => q.eq("sprint_id", args.sprint_id))
      .collect();
  },
});

export const closeSprint = mutation({
  args: {},
  handler: async (ctx) => {
    const active = await ctx.db.query("sprints")
      .withIndex("by_status", q => q.eq("status", "active"))
      .first();
    if (!active) return null;
    await ctx.db.patch(active._id, { status: "closed", closed_at: new Date().toISOString() });
    return active._id;
  },
});

export const listUpdates = query({
  args: {
    sprint_id: v.optional(v.id("sprints")),
    week_label: v.optional(v.string()),
    person: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let results;
    if (args.sprint_id) {
      results = await ctx.db.query("sprint_updates")
        .withIndex("by_sprint", q => q.eq("sprint_id", args.sprint_id!))
        .collect();
    } else if (args.week_label) {
      results = await ctx.db.query("sprint_updates")
        .withIndex("by_week", q => q.eq("week_label", args.week_label!))
        .collect();
    } else if (args.person) {
      results = await ctx.db.query("sprint_updates")
        .withIndex("by_person", q => q.eq("person", args.person!))
        .collect();
    } else {
      results = await ctx.db.query("sprint_updates").collect();
    }
    // Apply additional filters
    if (args.sprint_id && args.week_label) {
      results = results.filter(u => u.week_label === args.week_label);
    }
    if (args.sprint_id && args.person) {
      results = results.filter(u => u.person === args.person);
    }
    return results;
  },
});

export const patchUpdate = mutation({
  args: {
    update_id: v.id("sprint_updates"),
    notified_slack: v.optional(v.boolean()),
    notified_email: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { update_id, ...updates } = args;
    const filtered = Object.fromEntries(Object.entries(updates).filter(([_, v]) => v !== undefined));
    await ctx.db.patch(update_id, filtered);
    return update_id;
  },
});

export const getUpdateById = query({
  args: { update_id: v.id("sprint_updates") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.update_id);
  },
});
