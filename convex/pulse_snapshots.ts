import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const getByDate = query({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.query("pulse_snapshots")
      .withIndex("by_date", q => q.eq("date", args.date))
      .first();
  },
});

export const listRecent = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db.query("pulse_snapshots")
      .order("desc")
      .take(args.days ?? 7);
  },
});

export const create = mutation({
  args: {
    date: v.string(),
    active_tasks: v.optional(v.number()),
    done_today: v.optional(v.number()),
    overdue: v.optional(v.number()),
    team_reliability: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Upsert by date
    const existing = await ctx.db.query("pulse_snapshots")
      .withIndex("by_date", q => q.eq("date", args.date))
      .first();
    if (existing) {
      const filtered = Object.fromEntries(Object.entries(args).filter(([_, v]) => v !== undefined));
      await ctx.db.patch(existing._id, filtered);
      return existing._id;
    }
    return await ctx.db.insert("pulse_snapshots", args);
  },
});
