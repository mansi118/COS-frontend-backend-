import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const create = mutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("performance_snapshots", args);
  },
});

export const getByPerson = query({
  args: { person: v.string() },
  handler: async (ctx, args) => {
    const results = await ctx.db.query("performance_snapshots")
      .withIndex("by_person", q => q.eq("person", args.person))
      .collect();
    results.sort((a, b) => (b.evaluated_at || "").localeCompare(a.evaluated_at || ""));
    return results[0] || null;
  },
});

export const listAll = query({
  handler: async (ctx) => {
    return await ctx.db.query("performance_snapshots").collect();
  },
});
