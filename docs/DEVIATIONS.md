# Deviations from the client SRS — require client sign-off

The client's SRS ("NRK Jewellers — Software Requirement Specification & RFP",
§14 System Architecture, §16 Developer Response Requirements) specifies two
things this build does **not** follow, per the project owner's explicit
instruction to proceed this way for Phase 1. Both should be confirmed with
NRK Jewellers before final delivery/sign-off.

## 1. Platform: web-only, not native Windows + Android

**SRS says:** "Desktop Platform: Windows 10/11 (Native, fast UI response)"
and a "Native Android App" for the mobile platform (§14, Executive Summary).

**Built instead:** A single responsive web application (Next.js), used in
the browser on Windows, Mac, tablets, Android and iPhone. No native Windows
installer and no native/React Native Android app.

**Why it matters:** The SRS's "fast UI response" expectation and the Stage 3
roadmap item ("Mobile Application: Android app connectivity, barcode
scanning, live dashboard sync") imply dedicated native clients. A browser app
can match most of this (including camera-based barcode scanning via
`getUserMedia`), but:
- Offline-first operation is weaker in a browser than a native Android app.
- There's no installable Windows desktop binary — only a browser tab/PWA.

**Recommendation:** If offline billing resilience or an installable desktop
app is a hard requirement, scope a Progressive Web App (installable, offline
cache via service worker) as a near-term addition — still web technology, no
separate codebase.

## 2. Database: Convex, not PostgreSQL

**SRS says:** "Database Engine: PostgreSQL or equivalent enterprise
relational database" (§14), and a **non-negotiable term**: "100% IP & Source
Code Ownership... No Developer Lock-in: Complete technical documentation,
setup scripts, and uncompiled source code must be handed over upon delivery."

**Built instead:** Convex — a hosted backend-as-a-service providing the
database, server functions, and realtime sync.

**Why it matters:** Convex is not a database you can self-host and hand over
as pure source the way a PostgreSQL dump and server can be. The application
and schema source code are 100% owned by NRK Jewellers and exportable, but
the *runtime* depends on an ongoing Convex account/subscription from Convex,
Inc. This is in tension with the SRS's explicit "no lock-in" and "one-time
payment" clauses, which read as written for a traditional self-hosted stack.

**Mitigation already in place:**
- All business logic, schema, and validation lives in this repository's
  `convex/` directory as plain TypeScript — nothing is hidden behind a
  no-code platform.
- Convex supports data export (snapshot export to NDJSON/S3) at any time, so
  NRK Jewellers is never without access to raw data.

**Recommendation:** Confirm with the client whether "no lock-in" is
specifically about *source code* (satisfied) or also about *infrastructure
vendor independence* (not satisfied by Convex). If the latter, the Phase 2
technical recommendation should be migrating the schema to a self-hosted
Postgres + Node/Next API route backend, which this schema design (documented
in `docs/ARCHITECTURE.md`) was kept portable enough to support.
