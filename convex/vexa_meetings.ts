import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {
    status: v.optional(v.string()),
    platform: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let results = await ctx.db.query("vexa_meetings").collect();
    if (args.status) results = results.filter(m => m.status === args.status);
    if (args.platform) results = results.filter(m => m.platform === args.platform);
    results.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    if (args.limit) results = results.slice(0, args.limit);
    return results;
  },
});

export const getByMeetingId = query({
  args: { meeting_id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.query("vexa_meetings")
      .withIndex("by_meeting_id", q => q.eq("meeting_id", args.meeting_id))
      .first();
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    platform: v.string(),
    meeting_id: v.string(),
    status: v.string(),
    start_time: v.optional(v.string()),
    participants: v.optional(v.array(v.string())),
    vexa_id: v.optional(v.number()),
    created_at: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("vexa_meetings", args);
  },
});

export const updateStatus = mutation({
  args: {
    meeting_id: v.string(),
    status: v.string(),
    end_time: v.optional(v.string()),
    duration_sec: v.optional(v.number()),
    transcript_available: v.optional(v.boolean()),
    intelligence_done: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("vexa_meetings")
      .withIndex("by_meeting_id", q => q.eq("meeting_id", args.meeting_id))
      .first();
    if (!existing) return null;
    const { meeting_id, ...updates } = args;
    const filtered = Object.fromEntries(Object.entries(updates).filter(([_, v]) => v !== undefined));
    await ctx.db.patch(existing._id, filtered);
    return existing._id;
  },
});

export const remove = mutation({
  args: { meeting_id: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("vexa_meetings")
      .withIndex("by_meeting_id", q => q.eq("meeting_id", args.meeting_id))
      .first();
    if (existing) await ctx.db.delete(existing._id);
    return !!existing;
  },
});
