import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const get = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("notification_config")
      .withIndex("by_key", q => q.eq("config_key", "main"))
      .first();
  },
});

export const set = mutation({
  args: {
    ceo: v.optional(v.any()),
    routes: v.optional(v.any()),
    contacts: v.optional(v.any()),
    slack: v.optional(v.any()),
    defaults: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("notification_config")
      .withIndex("by_key", q => q.eq("config_key", "main"))
      .first();
    const data = { ...args, config_key: "main", updated_at: new Date().toISOString() };
    if (existing) {
      const filtered = Object.fromEntries(Object.entries(data).filter(([_, v]) => v !== undefined));
      await ctx.db.patch(existing._id, filtered);
      return existing._id;
    }
    return await ctx.db.insert("notification_config", data);
  },
});
