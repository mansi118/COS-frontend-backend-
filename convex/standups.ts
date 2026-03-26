import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {
    date: v.optional(v.string()),
    person: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.person && args.date) {
      return await ctx.db.query("standups")
        .withIndex("by_person_and_date", q => q.eq("person", args.person!).eq("date", args.date!))
        .take(1);
    }
    if (args.date) {
      return await ctx.db.query("standups")
        .withIndex("by_date", q => q.eq("date", args.date!))
        .collect();
    }
    if (args.person) {
      const results = await ctx.db.query("standups")
        .withIndex("by_person", q => q.eq("person", args.person!))
        .order("desc")
        .take(args.limit ?? 30);
      return results;
    }
    return await ctx.db.query("standups").order("desc").take(args.limit ?? 100);
  },
});

export const getByPersonDate = query({
  args: { person: v.string(), date: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.query("standups")
      .withIndex("by_person_and_date", q => q.eq("person", args.person).eq("date", args.date))
      .first();
  },
});

export const getByDate = query({
  args: { date: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.query("standups")
      .withIndex("by_date", q => q.eq("date", args.date))
      .collect();
  },
});

export const create = mutation({
  args: {
    person: v.string(),
    name: v.optional(v.string()),
    date: v.string(),
    done: v.optional(v.string()),
    doing: v.optional(v.string()),
    blockers: v.optional(v.string()),
    mood: v.optional(v.string()),
    highlights: v.optional(v.array(v.string())),
    linked_tasks: v.optional(v.array(v.string())),
    doing_priorities: v.optional(v.any()),
    created_at: v.optional(v.string()),
    updated_at: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Upsert: delete existing for same person+date
    const existing = await ctx.db.query("standups")
      .withIndex("by_person_and_date", q => q.eq("person", args.person).eq("date", args.date))
      .first();
    if (existing) await ctx.db.delete(existing._id);
    return await ctx.db.insert("standups", args);
  },
});

export const update = mutation({
  args: {
    person: v.string(),
    date: v.string(),
    done: v.optional(v.string()),
    doing: v.optional(v.string()),
    blockers: v.optional(v.string()),
    mood: v.optional(v.string()),
    highlights: v.optional(v.array(v.string())),
    linked_tasks: v.optional(v.array(v.string())),
    doing_priorities: v.optional(v.any()),
    updated_at: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("standups")
      .withIndex("by_person_and_date", q => q.eq("person", args.person).eq("date", args.date))
      .first();
    if (!existing) return null;
    const { person, date, ...updates } = args;
    const filtered = Object.fromEntries(Object.entries(updates).filter(([_, v]) => v !== undefined));
    await ctx.db.patch(existing._id, filtered);
    return existing._id;
  },
});

export const remove = mutation({
  args: { person: v.string(), date: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("standups")
      .withIndex("by_person_and_date", q => q.eq("person", args.person).eq("date", args.date))
      .first();
    if (existing) await ctx.db.delete(existing._id);
    return !!existing;
  },
});
