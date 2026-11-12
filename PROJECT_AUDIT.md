# Project Audit — NRK Jewellers ERP

Scope and method: a code-level audit of the Convex backend (`convex/*.ts`) and
the Next.js billing UI, done by reading the actual execution paths (not
inferring from file names) and verifying every fix with `tsc --noEmit`,
`vitest run`, and a real deploy to the project's Convex dev deployment
(`npx convex dev --once`). No browser/UI automation, responsive-breakpoint
testing, or load testing was run in this session — see "Not covered" at the
bottom. This file supersedes the generic "audit everything from Vyapar" brief
with what's actually true of this codebase.

## 1. What this app actually is

Next.js 16 (App Router) + Convex backend, TypeScript throughout. Not a
generic retail POS — this is a jewellery-shop ERP where every physical item
is a serialized "box item" (unique piece, tracked by box number), not a
quantity-counted SKU. Money is integer paise, weight is integer milligrams,
percentages are integer basis points — no floats anywhere in financial math
(`src/lib/money.ts`, `src/lib/jewelry-calc.ts`). Multi-tenant via
`organizations`/`memberships`, RBAC enforced server-side in every Convex
function via `convex/lib/auth.ts`. Already documented in
`docs/ARCHITECTURE.md`, `docs/BILLING_RULES.md`, `docs/DEVIATIONS.md` — read
those for the parts of Phase 1 ("identify the stack", "understand the
schema") this file doesn't repeat.

This is not a legacy codebase that needs a rewrite. It's a deliberately
built, well-documented system with a few real defects, concentrated in
report/list queries that silently truncate data at scale, and one financial
trust gap in the purchases module. Both classes are fixed below.

## 2. Modules actually audited this session

Read in full and traced end-to-end: `sales.ts`, `purchases.ts`, `boxes.ts`,
`products.ts`, `stockAdjustments.ts`, `customers.ts`, `suppliers.ts`,
`cashBank.ts`, `expenses.ts`, `dashboard.ts`, `reports.ts`, `appSecurity.ts`,
`organizations.ts`, plus the New Bill (`src/app/(app)/sales/new/page.tsx`)
and New Purchase (`src/app/(app)/purchases/new/page.tsx`) screens and the
shared calculation libraries they both depend on.

Not read in this session: `ewayBills.ts`, `girvi.ts`, `metalRates.ts`,
`metalPurities.ts`, `taxConfigurations.ts`, `customFields.ts`,
`dataManagement.ts`, `accountingYears.ts`, `search.ts` (skimmed, see §5),
`memberships.ts`, `http.ts`, and the non-billing UI screens (settings,
inventory list pages, every report page's rendering). Treat those as
unaudited, not as "confirmed clean."

## 3. Issues found and fixed

| # | Issue | Severity | Files | Fix |
|---|---|---|---|---|
| 1 | `sales.create()` ran two full table scans of the entire `sales` table on every auto-numbered bill (common path) — the second (`assertUniqueInvoice`) was provably redundant given the first already guarantees uniqueness. | P2 perf | `convex/sales.ts` | Skip `assertUniqueInvoice` on the auto-numbered path; only call it when the operator typed a manual number. |
| 2 | Invalid numeric input in the New Bill form (wastage % > 100, negative rate, non-numeric text) was silently coerced to `0` by `rupeesToPaise`/`percentToBasisPoints` with no feedback — a typo could zero out a real charge and the bill would save as a plausible-looking wrong total. | **P0 correctness** | `src/app/(app)/sales/new/page.tsx` | Added `numberFieldError` validation surfaced inline (red text) on every line field, discount, payment split, and old-gold field; `finalizeSale` now blocks submission on any invalid field instead of silently proceeding. |
| 3 | `sales.listByDocumentType` took the 200 *most recent sales-table rows across all document types*, then filtered by `documentType` afterward — so if recent activity was mostly invoices, the Quotations/Proforma/Credit Notes/Returns list pages could return empty even though matching records exist. Same bug, same root cause, in `purchases.listByDocumentType`. | **P0 correctness** | `convex/sales.ts`, `convex/purchases.ts`, `convex/schema.ts` | Added a `by_org_and_type` index to both tables; both queries now filter by type at the index level before `take(200)`. (Left `purchases.list()` alone — its `documentType` is optional with legacy rows implicitly meaning `"purchase_invoice"`, so an index-equality filter there would silently drop old data; that path stays an unindexed scan deliberately.) |
| 4 | **Purchases module trusted the client's tax math.** The purchase bill screen computed `taxPaise` from a flat GST% input and sent the raw paise number to the server, which stored it without recomputing — unlike `sales.ts`, which always recomputes tax server-side from stored tax configs. A compromised or buggy client could submit any tax amount. | **P0 financial integrity** | `convex/purchases.ts`, `src/app/(app)/purchases/new/page.tsx` | Changed the `create`/`update` mutation contract from `taxPaise: number` to `gstBasisPoints: number`; the server now computes `taxPaise = basisPointsOf(subtotalPaise, gstBasisPoints)` itself (same formula, same helper already used by `sales.ts`), with a 0–100% server-side bound. |
| 5 | **The single most severe finding:** `getGstSalesRegister`, `getGstPurchaseRegister`, `getSalesReport`, and `getPurchaseReport` all took the 2000 (or 5000, for payments) *most recent* rows across all document types and all time, then filtered by the caller's `startDate`/`endDate` **after** that cap. Once an org accumulates more than ~2000 total sales/purchase-table rows — which happens within a year or two of normal billing — any report for an older date range (including a GSTR filing period) would silently return incomplete or empty results, with no error. | **P0 compliance/correctness** | `convex/reports.ts`, `convex/schema.ts` | Added a `by_org_and_time` index (`[organizationId, createdAt]`) to `sales`, `purchases`, and `payments`. All four report queries now range-query directly on that index (`.gte("createdAt", start).lte("createdAt", end)`), so they return every matching row regardless of total history size — this was a correctness fix disguised as a perf one. |

Every fix above was verified with `npx tsc --noEmit`, `npx vitest run`
(baseline: 50 passing / 3 pre-existing unrelated failures before *and* after
every change, confirmed by `git stash`), and a real `npx convex dev --once`
deploy that built the new indexes with no errors.

## 4. Round 2 fixes (same session, continued)

After the first pass above, these were also fixed and verified the same way
(`tsc`, `vitest`, a real Convex deploy) — plus, for these four, **actual
regression tests** added under `convex/scale-fixes.test.ts` and
`convex/appSecurity.test.ts` that reproduce the bug against the old code
(confirmed failing via `git stash` before the fix) and pass against the fix:

- **`dashboard.getSummary()`** had the same class of risk as the reports
  fix in §3: it took the 500/1000 most-recent `sales`/`purchases`/`payments`
  rows org-wide, then computed "today" and the 7-day trend from that window.
  Now range-queries the exact 7-day window directly via `by_org_and_time`,
  so it can't under-count once total history exceeds the old caps, and reads
  less data per load.
- **`sales.cancel()`'s stock-reversal check** scanned every `sales` row and
  every `stockMovements` row for the org, every time an invoice is
  cancelled, to find active returns/credit-notes. Narrowed the `sales` half
  of that scan to two indexed queries (by `by_org_and_type`) instead of one
  full-table scan filtered in JS. (The `stockMovements` half is unchanged —
  there's no indexed field to narrow it by cheaply without a larger schema
  change; left as a known residual cost on a low-frequency mutation.)
- **`appSecurity.verifyMyAppPin` had no rate limiting** on a 4–6 digit
  app-lock PIN — a stolen session token could brute-force up to a million
  combinations with no delay. Added a per-user failed-attempt counter and a
  5-minute lockout after 5 consecutive wrong guesses (`appSecurityInternal.ts`),
  surfaced in the UI (`app-lock-gate.tsx`) as a "try again in N minutes"
  message instead of the generic "doesn't match" error.

## 5. Issues found, deliberately not touched

These are real, but each needs either a product decision or a bigger,
riskier change than this session could verify without live browser access
(see §6):

- **Invoice-sequence gaps.** `allocateInvoiceNumber` increments its counter
  even when the candidate number collides with a manually-typed invoice
  number and gets rejected — causing small gaps in the auto-sequence. Rare
  in practice (manual numbers are uncommon), but worth knowing if the
  client's CA expects strictly gapless GST invoice numbering. Not fixed:
  the allocator is shared by every document type (sales, purchases,
  quotations, returns, orders), and the only clean fix changes its calling
  contract for all of them — too much blast radius for a rare, low-severity
  issue to take on without dedicated test coverage of every caller.
- **Customer/product/global-search pickers are capped at `take(500)`**
  (`customers.ts`, `search.ts`). Documented in-code as a deliberate Phase-1
  tradeoff ("bounded reads... fine at shop scale"), not an oversight. Once a
  shop accumulates more than 500 customers or products, the oldest ones
  silently stop appearing in the billing screen's customer picker and in
  global search. The real fix is a Convex `.searchIndex()` plus replacing
  the plain `<Select>` in the New Bill customer picker with a search-as-you-
  type combobox — a new UI pattern this codebase doesn't have yet. **Not
  attempted this session**: it's the single highest-traffic, highest-risk
  screen in the app, there's no existing combobox component to reuse, and
  this environment had no connected browser to verify the result in. Doing
  this without the ability to click through it in a real browser first
  would be reckless on the app's most critical screen.
- **`purchases/update()` and `sales/update()` RBAC is owner/admin-only**
  (`requireRole(auth, [])`), while customer/supplier edits are similarly
  locked down. This might be exactly the intended control, or it might be
  the "hard to find"/"confusing" friction mentioned in the original brief —
  flagging it as a product question, not changing access policy unilaterally.

## 6. Environment limitation: no browser testing was possible

This session had no connected Claude-in-Chrome browser extension (`tabs_context_mcp`
returned "Browser extension is not connected"). That means:

- **Zero UI click-through testing was performed** — not because it was
  skipped by choice, but because the tool to do it wasn't available. Every
  fix in §3/§4 was verified by `tsc`, the `vitest` suite, executed
  regression tests against a real Convex dev deployment, and in two cases
  (sales `numberFieldError`, nothing else) a standalone `node -e` check of
  the pure logic — never by loading the app in a browser and clicking
  through it.
- **No responsive/breakpoint testing** (320px–1920px) was performed, for
  the same reason.
- **The customer/product search-at-scale fix (§5) was deliberately not
  attempted**, specifically because it's the app's highest-risk screen and
  there was no way to verify a UI rewrite of it without a browser.
- If live UI verification matters before shipping these changes, install
  and connect the Claude-in-Chrome extension (https://claude.ai/chrome) in a
  future session and re-run a click-through pass on the New Bill, New
  Purchase, and reports screens — the specific screens this round changed.

## 7. What "scale testing" actually means here

No load/performance testing (measuring response times under concurrent
load) was done. But the §3 item 5 and §4 dashboard findings were **not**
left as pure code-reading guesses either: `convex/scale-fixes.test.ts`
seeds 250 and 2200+ rows directly into a real (in-memory) Convex backend via
`convex-test` and asserts the exact symptom described (a quotation / an old
sale going missing) — proven to fail against the pre-fix code and pass
against the fix, both confirmed by `git stash`/`git stash pop` + re-running
`vitest`. That's real evidence of correctness at the row-count scale that
matters for this bug class, short of an actual production-sized dataset or
measuring wall-clock latency.

## 8. Not covered in this session

- **No browser automation, UI click-through, or screenshot testing** —
  this environment has no connected browser extension; see §6.
- **No responsive/breakpoint testing** (320px–1920px), same reason.
- Inventory, settings, reports *rendering*, GST/e-way-bill, girvi (pawn), and
  metal-rate modules were not read this session.
- **No wall-clock performance/load testing** (concurrent users, response
  times under real traffic) — see §7 for what scale evidence does exist.
- **No UI/UX redesign or Vyapar comparison** was attempted — this session
  was a backend-correctness, targeted frontend-validation, and regression-
  test-writing pass, not the "Vyapar comparison and redesign" workstream
  from the original brief. That remains a distinct, unstarted piece of work.

Continuing any of the above — a seeded large-dataset load test, a browser
click-through pass once the extension is connected, or a UI/UX pass against
Vyapar — is reasonable next work, but should be scoped and run as its own
pass rather than assumed from this one.
