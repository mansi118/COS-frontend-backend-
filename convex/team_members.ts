import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  handler: async (ctx) => {
    return await ctx.db.query("team_members").collect();
  },
});

export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.query("team_members")
      .withIndex("by_slug", q => q.eq("slug", args.slug))
      .first();
  },
});

export const create = mutation({
  args: {
    slug: v.string(),
    name: v.string(),
    role: v.optional(v.string()),
    emoji: v.optional(v.string()),
    slack_id: v.optional(v.string()),
    email: v.optional(v.string()),
    created_at: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("team_members", args);
  },
});
