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
import type * as clients from "../clients.js";
import type * as followups from "../followups.js";
import type * as notifications from "../notifications.js";
import type * as performance from "../performance.js";
import type * as sprints from "../sprints.js";
import type * as team_members from "../team_members.js";
import type * as vexa_meetings from "../vexa_meetings.js";
import type * as voice_updates from "../voice_updates.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  board_snapshots: typeof board_snapshots;
  clients: typeof clients;
  followups: typeof followups;
  notifications: typeof notifications;
  performance: typeof performance;
  sprints: typeof sprints;
  team_members: typeof team_members;
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
