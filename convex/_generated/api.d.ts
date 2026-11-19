/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accountEntries from "../accountEntries.js";
import type * as accountingYears from "../accountingYears.js";
import type * as appPreferences from "../appPreferences.js";
import type * as appSecurity from "../appSecurity.js";
import type * as appSecurityInternal from "../appSecurityInternal.js";
import type * as auditTrail from "../auditTrail.js";
import type * as auth from "../auth.js";
import type * as autoBackup from "../autoBackup.js";
import type * as balanceSheet from "../balanceSheet.js";
import type * as boxEntries from "../boxEntries.js";
import type * as boxes from "../boxes.js";
import type * as cashBank from "../cashBank.js";
import type * as cashReports from "../cashReports.js";
import type * as crons from "../crons.js";
import type * as customFields from "../customFields.js";
import type * as customers from "../customers.js";
import type * as dashboard from "../dashboard.js";
import type * as dataManagement from "../dataManagement.js";
import type * as ewayBills from "../ewayBills.js";
import type * as expenses from "../expenses.js";
import type * as girvi from "../girvi.js";
import type * as gstReports from "../gstReports.js";
import type * as http from "../http.js";
import type * as itemStock from "../itemStock.js";
import type * as lib_accountingYears from "../lib/accountingYears.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_boxStock from "../lib/boxStock.js";
import type * as lib_customFieldValues from "../lib/customFieldValues.js";
import type * as lib_itemStock from "../lib/itemStock.js";
import type * as lib_purity from "../lib/purity.js";
import type * as lib_sequences from "../lib/sequences.js";
import type * as memberships from "../memberships.js";
import type * as metalPurities from "../metalPurities.js";
import type * as metalRates from "../metalRates.js";
import type * as organizationBootstrap from "../organizationBootstrap.js";
import type * as organizations from "../organizations.js";
import type * as partyReports from "../partyReports.js";
import type * as products from "../products.js";
import type * as purchases from "../purchases.js";
import type * as reports from "../reports.js";
import type * as sales from "../sales.js";
import type * as search from "../search.js";
import type * as stockAdjustments from "../stockAdjustments.js";
import type * as stockCategories from "../stockCategories.js";
import type * as stockGroups from "../stockGroups.js";
import type * as stockReports from "../stockReports.js";
import type * as suppliers from "../suppliers.js";
import type * as taxConfigurations from "../taxConfigurations.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accountEntries: typeof accountEntries;
  accountingYears: typeof accountingYears;
  appPreferences: typeof appPreferences;
  appSecurity: typeof appSecurity;
  appSecurityInternal: typeof appSecurityInternal;
  auditTrail: typeof auditTrail;
  auth: typeof auth;
  autoBackup: typeof autoBackup;
  balanceSheet: typeof balanceSheet;
  boxEntries: typeof boxEntries;
  boxes: typeof boxes;
  cashBank: typeof cashBank;
  cashReports: typeof cashReports;
  crons: typeof crons;
  customFields: typeof customFields;
  customers: typeof customers;
  dashboard: typeof dashboard;
  dataManagement: typeof dataManagement;
  ewayBills: typeof ewayBills;
  expenses: typeof expenses;
  girvi: typeof girvi;
  gstReports: typeof gstReports;
  http: typeof http;
  itemStock: typeof itemStock;
  "lib/accountingYears": typeof lib_accountingYears;
  "lib/auth": typeof lib_auth;
  "lib/boxStock": typeof lib_boxStock;
  "lib/customFieldValues": typeof lib_customFieldValues;
  "lib/itemStock": typeof lib_itemStock;
  "lib/purity": typeof lib_purity;
  "lib/sequences": typeof lib_sequences;
  memberships: typeof memberships;
  metalPurities: typeof metalPurities;
  metalRates: typeof metalRates;
  organizationBootstrap: typeof organizationBootstrap;
  organizations: typeof organizations;
  partyReports: typeof partyReports;
  products: typeof products;
  purchases: typeof purchases;
  reports: typeof reports;
  sales: typeof sales;
  search: typeof search;
  stockAdjustments: typeof stockAdjustments;
  stockCategories: typeof stockCategories;
  stockGroups: typeof stockGroups;
  stockReports: typeof stockReports;
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
