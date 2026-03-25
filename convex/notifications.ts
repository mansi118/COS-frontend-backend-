import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const create = mutation({
  args: {
    update_id: v.optional(v.id("sprint_updates")),
    channel: v.string(),
    recipient: v.string(),
    status: v.string(),
    sent_at: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("notification_logs", args);
  },
});

export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const results = await ctx.db.query("notification_logs").collect();
    results.sort((a, b) => (b.sent_at || "").localeCompare(a.sent_at || ""));
    return results.slice(0, args.limit || 50);
  },
});
