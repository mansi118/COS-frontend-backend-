import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {
    status: v.optional(v.string()),
    owner: v.optional(v.string()),
    project_id: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let results;
    if (args.status) {
      results = await ctx.db.query("tasks")
        .withIndex("by_status", q => q.eq("status", args.status!))
        .take(args.limit ?? 200);
    } else if (args.owner) {
      results = await ctx.db.query("tasks")
        .withIndex("by_owner", q => q.eq("owner", args.owner!))
        .take(args.limit ?? 200);
    } else if (args.project_id) {
      results = await ctx.db.query("tasks")
        .withIndex("by_project", q => q.eq("project_id", args.project_id!))
        .take(args.limit ?? 200);
    } else {
      results = await ctx.db.query("tasks").take(args.limit ?? 200);
    }
    return results;
  },
});

export const getByTaskId = query({
  args: { task_id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.query("tasks")
      .withIndex("by_task_id", q => q.eq("task_id", args.task_id))
      .first();
  },
});

export const create = mutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("tasks", args);
  },
});

export const update = mutation({
  args: {
    task_id: v.string(),
    title: v.optional(v.string()),
    notes: v.optional(v.string()),
    status: v.optional(v.string()),
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
    updated: v.optional(v.string()),
    completed_at: v.optional(v.string()),
    trashed_at: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("tasks")
      .withIndex("by_task_id", q => q.eq("task_id", args.task_id))
      .first();
    if (!existing) return null;
    const { task_id, ...updates } = args;
    const filtered = Object.fromEntries(Object.entries(updates).filter(([_, v]) => v !== undefined));
    await ctx.db.patch(existing._id, filtered);
    return existing._id;
  },
});

export const complete = mutation({
  args: { task_id: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("tasks")
      .withIndex("by_task_id", q => q.eq("task_id", args.task_id))
      .first();
    if (!existing) return null;
    await ctx.db.patch(existing._id, {
      status: "completed",
      completed_at: new Date().toISOString(),
      updated: new Date().toISOString(),
    });
    return existing._id;
  },
});

export const uncomplete = mutation({
  args: { task_id: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("tasks")
      .withIndex("by_task_id", q => q.eq("task_id", args.task_id))
      .first();
    if (!existing) return null;
    await ctx.db.patch(existing._id, {
      status: "active",
      completed_at: undefined,
      updated: new Date().toISOString(),
    });
    return existing._id;
  },
});

export const trash = mutation({
  args: { task_id: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("tasks")
      .withIndex("by_task_id", q => q.eq("task_id", args.task_id))
      .first();
    if (!existing) return null;
    await ctx.db.patch(existing._id, {
      status: "trashed",
      trashed_at: new Date().toISOString(),
      updated: new Date().toISOString(),
    });
    return existing._id;
  },
});

export const restore = mutation({
  args: { task_id: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("tasks")
      .withIndex("by_task_id", q => q.eq("task_id", args.task_id))
      .first();
    if (!existing) return null;
    await ctx.db.patch(existing._id, {
      status: "active",
      trashed_at: undefined,
      updated: new Date().toISOString(),
    });
    return existing._id;
  },
});

export const remove = mutation({
  args: { task_id: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("tasks")
      .withIndex("by_task_id", q => q.eq("task_id", args.task_id))
      .first();
    if (existing) await ctx.db.delete(existing._id);
    return !!existing;
  },
});
