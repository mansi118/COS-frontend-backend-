import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const get = query({
  args: { counter_type: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.query("counters")
      .withIndex("by_type", q => q.eq("counter_type", args.counter_type))
      .first();
  },
});

export const increment = mutation({
  args: { counter_type: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("counters")
      .withIndex("by_type", q => q.eq("counter_type", args.counter_type))
      .first();
    if (existing) {
      const next = existing.next_val + 1;
      await ctx.db.patch(existing._id, { next_val: next });
      return next;
    }
    // First time — create counter starting at 1
    await ctx.db.insert("counters", { counter_type: args.counter_type, next_val: 2 });
    return 1;
  },
});

export const set = mutation({
  args: { counter_type: v.string(), next_val: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("counters")
      .withIndex("by_type", q => q.eq("counter_type", args.counter_type))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { next_val: args.next_val });
      return existing._id;
    }
    return await ctx.db.insert("counters", args);
  },
});
