/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as boxes from "../boxes.js";
import type * as customers from "../customers.js";
import type * as dashboard from "../dashboard.js";
import type * as http from "../http.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_sequences from "../lib/sequences.js";
import type * as metalPurities from "../metalPurities.js";
import type * as metalRates from "../metalRates.js";
import type * as organizations from "../organizations.js";
import type * as products from "../products.js";
import type * as purchases from "../purchases.js";
import type * as reports from "../reports.js";
import type * as sales from "../sales.js";
import type * as stockCategories from "../stockCategories.js";
import type * as stockGroups from "../stockGroups.js";
import type * as suppliers from "../suppliers.js";
import type * as taxConfigurations from "../taxConfigurations.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  boxes: typeof boxes;
  customers: typeof customers;
  dashboard: typeof dashboard;
  http: typeof http;
  "lib/auth": typeof lib_auth;
  "lib/sequences": typeof lib_sequences;
  metalPurities: typeof metalPurities;
  metalRates: typeof metalRates;
  organizations: typeof organizations;
  products: typeof products;
  purchases: typeof purchases;
  reports: typeof reports;
  sales: typeof sales;
  stockCategories: typeof stockCategories;
  stockGroups: typeof stockGroups;
  suppliers: typeof suppliers;
  taxConfigurations: typeof taxConfigurations;
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
