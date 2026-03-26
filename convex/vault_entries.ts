import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {
    namespace: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.namespace) {
      return await ctx.db.query("vault_entries")
        .withIndex("by_namespace", q => q.eq("namespace", args.namespace!))
        .take(args.limit ?? 100);
    }
    return await ctx.db.query("vault_entries").take(args.limit ?? 100);
  },
});

export const getByKey = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.query("vault_entries")
      .withIndex("by_key", q => q.eq("key", args.key))
      .first();
  },
});

export const create = mutation({
  args: {
    key: v.string(),
    namespace: v.optional(v.string()),
    content: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    source: v.optional(v.string()),
    created: v.optional(v.string()),
    modified: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("vault_entries", args);
  },
});
