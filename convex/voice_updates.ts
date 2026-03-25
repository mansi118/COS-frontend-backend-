import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {
    who: v.optional(v.string()),
    type: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let results = await ctx.db.query("voice_updates").collect();
    if (args.who) results = results.filter(v => v.who === args.who);
    if (args.type) results = results.filter(v => v.type === args.type);
    results.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    if (args.limit) results = results.slice(0, args.limit);
    return results;
  },
});

export const getByVuId = query({
  args: { vu_id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.query("voice_updates")
      .withIndex("by_vu_id", q => q.eq("vu_id", args.vu_id))
      .first();
  },
});

export const create = mutation({
  args: {
    vu_id: v.string(),
    who: v.string(),
    type: v.string(),
    audio_url: v.optional(v.string()),
    audio_format: v.optional(v.string()),
    duration_sec: v.optional(v.number()),
    transcript: v.optional(v.string()),
    summary: v.optional(v.string()),
    routed_to: v.optional(v.array(v.object({ type: v.string(), id: v.string() }))),
    listened_by: v.optional(v.array(v.string())),
    priority: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    created_at: v.optional(v.string()),
    updated_at: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("voice_updates", args);
  },
});

export const update = mutation({
  args: {
    vu_id: v.string(),
    transcript: v.optional(v.string()),
    summary: v.optional(v.string()),
    routed_to: v.optional(v.array(v.object({ type: v.string(), id: v.string() }))),
    listened_by: v.optional(v.array(v.string())),
    updated_at: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("voice_updates")
      .withIndex("by_vu_id", q => q.eq("vu_id", args.vu_id))
      .first();
    if (!existing) return null;
    const { vu_id, ...updates } = args;
    const filtered = Object.fromEntries(Object.entries(updates).filter(([_, v]) => v !== undefined));
    await ctx.db.patch(existing._id, filtered);
    return existing._id;
  },
});

export const remove = mutation({
  args: { vu_id: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("voice_updates")
      .withIndex("by_vu_id", q => q.eq("vu_id", args.vu_id))
      .first();
    if (existing) await ctx.db.delete(existing._id);
    return !!existing;
  },
});
