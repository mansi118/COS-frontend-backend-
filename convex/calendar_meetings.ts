import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const getByDate = query({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.query("calendar_meetings")
      .withIndex("by_date", q => q.eq("date", args.date))
      .first();
  },
});

export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db.query("calendar_meetings")
      .order("desc")
      .take(args.limit ?? 30);
  },
});

export const upsert = mutation({
  args: {
    date: v.string(),
    timezone: v.optional(v.string()),
    meetings: v.optional(v.array(v.any())),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("calendar_meetings")
      .withIndex("by_date", q => q.eq("date", args.date))
      .first();
    const data = { ...args, updated_at: new Date().toISOString() };
    if (existing) {
      await ctx.db.patch(existing._id, data);
      return existing._id;
    }
    return await ctx.db.insert("calendar_meetings", data);
  },
});
