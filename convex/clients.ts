import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  handler: async (ctx) => {
    return await ctx.db.query("clients").collect();
  },
});

export const getBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.query("clients")
      .withIndex("by_slug", q => q.eq("slug", args.slug))
      .first();
  },
});

export const create = mutation({
  args: {
    slug: v.string(),
    name: v.string(),
    industry: v.optional(v.string()),
    phase: v.optional(v.string()),
    contract_value: v.optional(v.string()),
    health_score: v.optional(v.number()),
    last_interaction: v.optional(v.string()),
    last_interaction_type: v.optional(v.string()),
    sentiment: v.optional(v.string()),
    overdue_invoices: v.optional(v.number()),
    deliverables_on_track: v.optional(v.boolean()),
    created_at: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("clients", args);
  },
});

export const insertContact = mutation({
  args: {
    client_slug: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    role: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("client_contacts", args);
  },
});

export const listContacts = query({
  args: { client_slug: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.query("client_contacts")
      .withIndex("by_client", q => q.eq("client_slug", args.client_slug))
      .collect();
  },
});

export const update = mutation({
  args: {
    slug: v.string(),
    health_score: v.optional(v.number()),
    sentiment: v.optional(v.string()),
    phase: v.optional(v.string()),
    last_interaction: v.optional(v.string()),
    last_interaction_type: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("clients")
      .withIndex("by_slug", q => q.eq("slug", args.slug))
      .first();
    if (!existing) return null;
    const { slug, ...updates } = args;
    const filtered = Object.fromEntries(Object.entries(updates).filter(([_, v]) => v !== undefined));
    await ctx.db.patch(existing._id, filtered);
    return existing._id;
  },
});
