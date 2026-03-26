import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// --- Projects ---

export const listProjects = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("taskflow_projects").collect();
  },
});

export const createProject = mutation({
  args: {
    project_id: v.string(),
    name: v.string(),
    color: v.optional(v.string()),
    status: v.optional(v.string()),
    notes: v.optional(v.string()),
    area_id: v.optional(v.string()),
    deadline: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("taskflow_projects", args);
  },
});

export const updateProject = mutation({
  args: {
    project_id: v.string(),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
    status: v.optional(v.string()),
    notes: v.optional(v.string()),
    area_id: v.optional(v.string()),
    deadline: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("taskflow_projects")
      .withIndex("by_project_id", q => q.eq("project_id", args.project_id))
      .first();
    if (!existing) return null;
    const { project_id, ...updates } = args;
    const filtered = Object.fromEntries(Object.entries(updates).filter(([_, v]) => v !== undefined));
    await ctx.db.patch(existing._id, filtered);
    return existing._id;
  },
});

export const deleteProject = mutation({
  args: { project_id: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("taskflow_projects")
      .withIndex("by_project_id", q => q.eq("project_id", args.project_id))
      .first();
    if (existing) await ctx.db.delete(existing._id);
    return !!existing;
  },
});

// --- Areas ---

export const listAreas = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("taskflow_areas").collect();
  },
});

export const createArea = mutation({
  args: {
    area_id: v.string(),
    name: v.string(),
    color: v.optional(v.string()),
    icon: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("taskflow_areas", args);
  },
});

export const updateArea = mutation({
  args: {
    area_id: v.string(),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
    icon: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("taskflow_areas")
      .withIndex("by_area_id", q => q.eq("area_id", args.area_id))
      .first();
    if (!existing) return null;
    const { area_id, ...updates } = args;
    const filtered = Object.fromEntries(Object.entries(updates).filter(([_, v]) => v !== undefined));
    await ctx.db.patch(existing._id, filtered);
    return existing._id;
  },
});

export const deleteArea = mutation({
  args: { area_id: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("taskflow_areas")
      .withIndex("by_area_id", q => q.eq("area_id", args.area_id))
      .first();
    if (existing) await ctx.db.delete(existing._id);
    return !!existing;
  },
});

// --- Tags ---

export const listTags = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("taskflow_tags").collect();
  },
});

export const createTag = mutation({
  args: {
    tag_id: v.string(),
    name: v.string(),
    slug: v.optional(v.string()),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("taskflow_tags", args);
  },
});

export const updateTag = mutation({
  args: {
    tag_id: v.string(),
    name: v.optional(v.string()),
    slug: v.optional(v.string()),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("taskflow_tags")
      .withIndex("by_tag_id", q => q.eq("tag_id", args.tag_id))
      .first();
    if (!existing) return null;
    const { tag_id, ...updates } = args;
    const filtered = Object.fromEntries(Object.entries(updates).filter(([_, v]) => v !== undefined));
    await ctx.db.patch(existing._id, filtered);
    return existing._id;
  },
});

export const deleteTag = mutation({
  args: { tag_id: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("taskflow_tags")
      .withIndex("by_tag_id", q => q.eq("tag_id", args.tag_id))
      .first();
    if (existing) await ctx.db.delete(existing._id);
    return !!existing;
  },
});
