# Architecture

See `docs/DEVIATIONS.md` for the two client-facing deviations from the SRS
(web-only platform, Convex instead of PostgreSQL) that need sign-off.

## Stack

- **Frontend:** Next.js App Router, React 19, TypeScript (strict), Tailwind
  v4, shadcn/ui.
- **Backend/DB:** Convex — schema in `convex/schema.ts`, server functions
  under `convex/`.
- **Auth:** `@convex-dev/auth`, email+password provider. RBAC is
  organization-membership based (see below), enforced server-side in every
  Convex function via `convex/lib/auth.ts`.

## Units convention (financial integrity, SRS §8/§18)

All financial and weight data is stored as integers — never floating point:

| Quantity | Unit | Example |
|---|---|---|
| Money | integer **paise** | ₹1,234.56 → `123456` |
| Weight | integer **milligrams** | 12.345g → `12345` |
| Percentages that need fractions (GST %, wastage %, purity) | integer **basis points** (1 bp = 0.01%) | 22K gold (91.66%) → `9166` |

Calculation helpers live in `src/lib/money.ts` and `src/lib/weight.ts`
(added as billing/purchase milestones need them) and are unit-tested
independent of any UI.

## Multi-tenancy & RBAC

- `organizations` / `branches` model the business; Phase 1 runs a single
  organization (NRK Jewellers) with one default branch, but every table
  carries `organizationId` so a second branch or a second tenant never
  requires a schema rewrite.
- `memberships` is the join between a Convex Auth `users` row and an
  `organizations` row, carrying `role`. A user can't act on an organization
  without an active membership row — `requireAuthContext()` resolves this on
  every server function, so the client can never claim an organization or
  role it doesn't actually have.
- Roles: `owner`, `admin`, `billing_operator`, `inventory_manager`,
  `purchase_manager`, `accountant` (SRS §19). Owner/admin bypass granular
  checks; other roles are checked explicitly per mutation via `requireRole()`.
- The **first person ever to sign in** is bootstrapped as Owner of a new
  organization (`convex/organizations.ts: ensureBootstrapped`). Anyone else
  who signs up with no membership is shown a pending-access screen — adding
  them to the org is a Settings > Users and Roles action (future milestone).

## Data integrity patterns used throughout

- **Append-only ledgers, not overwritten balances:** `stockMovements`,
  `customerLedgerEntries`, `supplierLedgerEntries`, `metalRates` are all
  insert-only. A balance or "current rate" is a read of the latest/aggregated
  rows, not a field that gets mutated in place — so there is always an audit
  trail and historical bills are never retroactively changed by a later rate
  update (SRS §14 "Gold Rate History").
- **Snapshotted rates/tax on finalized documents:** `sales`/`saleItems` and
  `purchases`/`purchaseItems` store the rate, purity and tax actually applied
  at the time, not a reference to look up later.
- **Atomic finalization:** every "finalize a sale/purchase" action (stock
  deduction, ledger entry, invoice numbering, audit log) happens inside one
  Convex mutation. Convex mutations are transactional, so this is one
  all-or-nothing database transaction rather than several round trips that
  could partially fail.
- **Invoice numbering:** `invoiceSequences` is incremented atomically inside
  the same mutation that creates the document — never derived by counting
  existing rows, which would race under concurrent billing.
- **Duplicate-submission protection:** `sales.idempotencyKey` (client
  generates a UUID per bill attempt) is unique-checked before finalizing, so
  a double-tapped "Save" button or a retried request cannot create two
  invoices.

## Convex read/write optimization

- Every list query is indexed by `organizationId` (and a second key where
  relevant) — no unindexed table scans.
- Relatively static config (stock groups/categories, metal purities, tax
  configs) is fetched once per screen and cached by Convex's reactive query
  cache rather than re-queried.
- Dashboard metrics (future milestone) will be computed from indexed
  aggregation queries scoped by date range, not by loading full transaction
  history client-side.
