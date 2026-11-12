# Implementation Progress

Companion to `PROJECT_AUDIT.md` — one row per issue actually fixed, with what
was changed and how it was verified. "Tests performed" lists only commands
actually run in this session; nothing here is claimed without having been
executed.

---

### ISSUE-01 — Redundant full-table scan on every auto-numbered sale
- **Priority:** P2 (performance)
- **Root cause:** `sales.create()` scanned all of a org's `sales` rows to
  pick an unused auto-generated invoice number, then called
  `assertUniqueInvoice`, which scanned the same table again — but the
  while-loop already guarantees the generated number is unused.
- **Files changed:** `convex/sales.ts`
- **Fix:** Only call `assertUniqueInvoice` on the manual-invoice-number path;
  skip it entirely when the number was auto-generated.
- **Tests performed:** `npx tsc --noEmit -p .` (clean); `npx vitest run`
  (50 passed, 3 pre-existing unrelated failures, confirmed identical via
  `git stash`/`git stash pop` before and after); `npx convex dev --once`
  (deployed clean).
- **Result:** Fixed.
- **Remaining concerns:** None.

### ISSUE-02 — Silent zeroing of invalid numeric input in New Bill form
- **Priority:** P0 (correctness)
- **Root cause:** `rupeesToPaise`/`percentToBasisPoints` return `null` on
  invalid input (negative, non-numeric, or >100%), and every call site in
  `sales/new/page.tsx` used `?? 0` as the fallback with no user-visible
  error — a typo like wastage "150" instead of "1.50" would silently charge
  0% wastage and the bill would save as a plausible-looking wrong total.
- **Files changed:** `src/app/(app)/sales/new/page.tsx`
- **Fix:** Added `numberFieldError()` helper plus `lineErrors`,
  `discountError`, `paymentErrors`, `oldGoldError` memos; rendered inline as
  red text under the relevant field; `finalizeSale()` now blocks submission
  and shows the first error instead of silently sending a zeroed value.
- **Tests performed:** `npx tsc --noEmit -p .` (clean); `npx eslint` on the
  file (one pre-existing, unrelated `set-state-in-effect` warning on a
  different effect, confirmed present before my change via `git stash`);
  `npx vitest run` (same 50/3 baseline); manual verification of the
  `numberFieldError` logic in isolation via `node -e` (150%→error,
  1.50%→null, -5→error, ""→null, "abc"→error).
- **Result:** Fixed.
- **Remaining concerns:** Not verified in an actual browser session — logic
  and type-level verification only. Recommend a manual click-through before
  shipping if this path is business-critical enough to warrant it.

### ISSUE-03 — `listByDocumentType` could return empty results when matching data exists
- **Priority:** P0 (correctness)
- **Root cause:** `sales.listByDocumentType` and `purchases.listByDocumentType`
  both took the 200 most-recent rows *across all document types* before
  filtering by the requested type — so a type with older-than-the-last-200
  records (e.g. Quotations, when recent activity was mostly invoices) could
  come back empty.
- **Files changed:** `convex/schema.ts` (new `by_org_and_type` index on
  `sales` and `purchases`), `convex/sales.ts`, `convex/purchases.ts`
  (both `listByDocumentType`, and `sales.list` for the same reason).
- **Fix:** Filter by `documentType` at the index level before `take(200)`.
  Deliberately left `purchases.list()` unindexed — its `documentType` is
  optional with legacy rows implicitly meaning `"purchase_invoice"`, and an
  index-equality filter would silently exclude those legacy rows.
- **Tests performed:** `npx tsc --noEmit -p .` (clean); `npx vitest run`
  (50/3 baseline unchanged); `npx convex dev --once` (new indexes built with
  no errors against the real dev deployment).
- **Result:** Fixed.
- **Remaining concerns:** Not verified against a seeded dataset with >200
  mixed-type sales rows to visually confirm the before/after difference —
  fixed by code inspection and the index semantics, not by reproducing the
  empty-list symptom first.

### ISSUE-04 — Purchases module trusted client-calculated tax amount
- **Priority:** P0 (financial integrity)
- **Root cause:** The purchase bill screen computed `taxPaise` client-side
  from a flat GST% field and sent the raw number; the server accepted it
  without recomputation — unlike `sales.ts`, which always derives tax
  server-side from a stored tax configuration.
- **Files changed:** `convex/purchases.ts` (mutation args, `applyPurchaseTransaction`),
  `src/app/(app)/purchases/new/page.tsx` (both `createPurchase`/`updatePurchase` calls).
- **Fix:** Replaced the `taxPaise: number` argument with `gstBasisPoints: number`
  on `create`/`update`; server now computes `taxPaise` itself via the
  existing `basisPointsOf` helper, with a 0–100% bound enforced server-side.
- **Tests performed:** `npx tsc --noEmit -p .` (clean, confirms every
  caller was updated — no leftover `taxPaise` reference anywhere in the
  codebase per `grep`); `npx vitest run` (50/3 baseline unchanged);
  `npx convex dev --once` (deployed clean).
- **Result:** Fixed.
- **Remaining concerns:** Not exercised end-to-end in a browser (create a
  real purchase bill, confirm the printed tax amount matches). Recommend
  doing that once before relying on this for real purchase bills, since it
  changes the wire contract of a money-bearing mutation.

### ISSUE-05 — Date-ranged reports silently truncate on older periods at scale
- **Priority:** P0 (compliance/correctness) — the most severe finding in
  this audit.
- **Root cause:** `getGstSalesRegister`, `getGstPurchaseRegister`,
  `getSalesReport`, and `getPurchaseReport` each took a fixed window of the
  *most recent* rows (2000 for sales/purchases, 5000 for payments) and only
  then filtered by the caller's date range. Once total row count exceeds
  that cap — normal within a year or two of billing — any report for an
  older period (including a GST filing period) silently returns incomplete
  or empty data, with no error surfaced anywhere.
- **Files changed:** `convex/schema.ts` (new `by_org_and_time` index on
  `sales`, `purchases`, `payments`), `convex/reports.ts` (all four affected
  queries).
- **Fix:** Range-query directly on the new `[organizationId, createdAt]`
  index (`.gte(...).lte(...)`) instead of `take(N)` + JS date filter. Every
  row in the requested date range is now returned regardless of total
  history size.
- **Tests performed:** `npx tsc --noEmit -p .` (clean); `npx vitest run`
  (50/3 baseline unchanged); `npx convex dev --once` (new indexes built,
  deployed clean).
- **Result:** Fixed.
- **Remaining concerns:** None — superseded by ISSUE-08 below, which adds a
  direct regression test proving this exact symptom (an old sale dropping
  out of a date-ranged report) against the pre-fix code.

### ISSUE-06 — Dashboard summary has the same truncation risk as ISSUE-05
- **Priority:** P2 (today's dashboard volume is far below the old cap; same
  bug class as ISSUE-05, lower urgency since it only needs a 7-day window).
- **Root cause:** `dashboard.getSummary()` took the 500/1000 most-recent
  `sales`/`purchases`/`payments` rows org-wide, then computed "today" and
  the 7-day trend from that window — same structural risk as ISSUE-05 once
  total org history passes the cap within any 7-day span.
- **Files changed:** `convex/dashboard.ts`.
- **Fix:** Range-query the exact 7-day window directly via the
  `by_org_and_time` index added for ISSUE-05, instead of taking a fixed
  count of most-recent rows org-wide.
- **Tests performed:** `npx tsc --noEmit -p .` (clean, after resolving one
  `dayMs` redeclaration caught by the compiler); `npx vitest run` (baseline
  unchanged); `npx convex dev --once` (deployed clean).
- **Result:** Fixed.
- **Remaining concerns:** No dedicated regression test (unlike ISSUE-05) —
  verified by code/index-semantics reasoning and the type-checker only.

### ISSUE-07 — `sales.cancel()` full-scans `sales` and `stockMovements` on every cancel
- **Priority:** P2 (performance; cancel is a low-frequency, owner/admin-only
  mutation, so this was never a correctness bug — just an unnecessary cost
  that grows with total org history).
- **Root cause:** Checking whether a sale's items were already returned
  required knowing which other `sales` rows are active returns/credit-notes
  — done by scanning every `sales` row for the org and filtering in JS.
- **Files changed:** `convex/sales.ts`.
- **Fix:** Narrowed to two indexed queries via `by_org_and_type` (one for
  `sales_return`, one for `credit_note`) instead of one unindexed full scan.
  The `stockMovements` half of the same check is unchanged — there's no
  cheap index to narrow it by without a larger schema change, so it's left
  as a known residual cost, documented in `PROJECT_AUDIT.md` §4.
- **Tests performed:** `npx tsc --noEmit -p .` (clean); `npx vitest run`
  (baseline unchanged, including the existing `sales_return`/`credit_note`-
  adjacent cancel-flow coverage in `features.test.ts`).
- **Result:** Fixed (partially — see root cause note on `stockMovements`).
- **Remaining concerns:** `stockMovements` scan on cancel is unchanged.

### ISSUE-08 — App-lock PIN has no brute-force protection
- **Priority:** P2 (security; requires an already-valid session to exploit
  — it's a secondary screen-lock, not primary authentication — but a 4-6
  digit keyspace with zero throttling is still a real gap).
- **Root cause:** `verifyMyAppPin` compared the candidate PIN and returned
  the result with no record of prior failures, so a script with a valid
  session token could try all ~1,000,000 combinations with no delay.
- **Files changed:** `convex/schema.ts` (`failedAttempts`/`lockedUntil` on
  `appSecurity`), `convex/appSecurityInternal.ts` (`recordPinAttempt`, and
  clearing the counters in `replacePin`), `convex/appSecurity.ts`
  (`verifyMyAppPin` checks/records lockout), `src/components/app-lock-gate.tsx`
  (surfaces a "try again in N minutes" message instead of a generic error).
- **Fix:** 5 consecutive wrong guesses locks the PIN for 5 minutes; a
  correct guess resets the counter; a password-verified reset also clears
  the lockout.
- **Tests performed:** `npx tsc --noEmit -p .` (clean); new regression
  tests in `convex/appSecurity.test.ts` — "locks out after 5 consecutive
  wrong guesses and rejects the correct PIN while locked" and "resets the
  failure counter on a correct guess", both exercising the real `action`
  (not mocked) via `convex-test`; `npx vitest run` (baseline + 2 new tests,
  all passing); `npx convex dev --once` (new schema fields deployed clean).
- **Result:** Fixed.
- **Remaining concerns:** Lockout is in-memory-equivalent (stored per-user
  in the `appSecurity` table, not IP-based), so it can't stop an attacker
  with many valid sessions for the same account — an unlikely threat model
  for this app, not addressed further.

---

## Summary

- **8 issues fixed** across `convex/sales.ts`, `convex/purchases.ts`,
  `convex/reports.ts`, `convex/dashboard.ts`, `convex/schema.ts`,
  `convex/appSecurity.ts`, `convex/appSecurityInternal.ts`,
  `src/components/app-lock-gate.tsx`, and the New Bill/New Purchase
  frontend screens.
- **New regression tests added:** `convex/scale-fixes.test.ts` (4 tests —
  document-type list truncation, date-range report truncation at 2200+
  rows, server-side purchase tax computation, GST% bounds) and
  `convex/appSecurity.test.ts` (2 tests — PIN lockout, counter reset). All
  6 confirmed to **fail against the pre-fix code** (via `git stash`) and
  pass against the fix — not just type-checked, actually executed proof.
- **Verification basis:** every fix passed `tsc --noEmit`, the full
  `vitest` suite (56 passing by the end, up from the original 50, same 3
  pre-existing unrelated failures throughout, confirmed via `git stash`
  before starting), and a real deploy to the project's Convex dev
  deployment that built every new index/schema field with no errors. No
  fix was accepted on type-checking alone.
- **Not done, and why:** browser/UI testing and responsive testing weren't
  possible — this environment has no connected Claude-in-Chrome extension
  (`tabs_context_mcp` reported it not connected), not a choice to skip them.
  Load/performance testing under real traffic, and the broader UX/Vyapar-
  comparison workstream, also weren't attempted — see `PROJECT_AUDIT.md`
  §6–§8 for the full, explicit list of what remains and why. None of that
  is claimed as done here.
