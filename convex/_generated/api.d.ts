/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as board_snapshots from "../board_snapshots.js";
import type * as calendar_meetings from "../calendar_meetings.js";
import type * as clients from "../clients.js";
import type * as counters from "../counters.js";
import type * as eod_snapshots from "../eod_snapshots.js";
import type * as followups from "../followups.js";
import type * as notification_config from "../notification_config.js";
import type * as notifications from "../notifications.js";
import type * as performance from "../performance.js";
import type * as pulse_snapshots from "../pulse_snapshots.js";
import type * as sprints from "../sprints.js";
import type * as standups from "../standups.js";
import type * as taskflow_meta from "../taskflow_meta.js";
import type * as tasks from "../tasks.js";
import type * as team_members from "../team_members.js";
import type * as vault_entries from "../vault_entries.js";
import type * as vexa_meetings from "../vexa_meetings.js";
import type * as voice_updates from "../voice_updates.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  board_snapshots: typeof board_snapshots;
  calendar_meetings: typeof calendar_meetings;
  clients: typeof clients;
  counters: typeof counters;
  eod_snapshots: typeof eod_snapshots;
  followups: typeof followups;
  notification_config: typeof notification_config;
  notifications: typeof notifications;
  performance: typeof performance;
  pulse_snapshots: typeof pulse_snapshots;
  sprints: typeof sprints;
  standups: typeof standups;
  taskflow_meta: typeof taskflow_meta;
  tasks: typeof tasks;
  team_members: typeof team_members;
  vault_entries: typeof vault_entries;
  vexa_meetings: typeof vexa_meetings;
  voice_updates: typeof voice_updates;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
