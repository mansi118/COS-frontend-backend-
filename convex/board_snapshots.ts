import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const create = mutation({
  args: {
    date: v.string(),
    data: v.any(),
    created_at: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("board_snapshots", args);
  },
});

export const getByDate = query({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.query("board_snapshots")
      .withIndex("by_date", q => q.eq("date", args.date))
      .first();
  },
});

export const latest = query({
  handler: async (ctx) => {
    const results = await ctx.db.query("board_snapshots").collect();
    results.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    return results[0] || null;
  },
});
