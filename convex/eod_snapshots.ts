import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const latest = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("eod_snapshots")
      .order("desc")
      .first();
  },
});

export const getByDate = query({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.query("eod_snapshots")
      .withIndex("by_date", q => q.eq("date", args.date))
      .first();
  },
});

export const create = mutation({
  args: {
    date: v.string(),
    data: v.any(),
    created_at: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("eod_snapshots", args);
  },
});
