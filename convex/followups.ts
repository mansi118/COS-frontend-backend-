import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {
    status: v.optional(v.string()),
    who: v.optional(v.string()),
    priority: v.optional(v.string()),
    source: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let results = await ctx.db.query("followups").collect();
    if (args.status) results = results.filter(f => f.status === args.status);
    if (args.who) results = results.filter(f => f.who === args.who);
    if (args.priority) results = results.filter(f => f.priority === args.priority);
    if (args.source) results = results.filter(f => f.source === args.source);
    return results.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  },
});

export const getByFuId = query({
  args: { fu_id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.query("followups")
      .withIndex("by_fu_id", q => q.eq("fu_id", args.fu_id))
      .first();
  },
});

export const create = mutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("followups", args);
  },
});

export const update = mutation({
  args: {
    fu_id: v.string(),
    what: v.optional(v.string()),
    who: v.optional(v.string()),
    due: v.optional(v.string()),
    priority: v.optional(v.string()),
    status: v.optional(v.string()),
    notes: v.optional(v.string()),
    checklist: v.optional(v.array(v.object({
      text: v.string(),
      priority: v.string(),
      completed: v.boolean(),
    }))),
    updated_at: v.optional(v.string()),
    resolved_at: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("followups")
      .withIndex("by_fu_id", q => q.eq("fu_id", args.fu_id))
      .first();
    if (!existing) return null;
    const { fu_id, ...updates } = args;
    const filtered = Object.fromEntries(Object.entries(updates).filter(([_, v]) => v !== undefined));
    await ctx.db.patch(existing._id, filtered);
    return existing._id;
  },
});

export const remove = mutation({
  args: { fu_id: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("followups")
      .withIndex("by_fu_id", q => q.eq("fu_id", args.fu_id))
      .first();
    if (existing) await ctx.db.delete(existing._id);
    return !!existing;
  },
});
