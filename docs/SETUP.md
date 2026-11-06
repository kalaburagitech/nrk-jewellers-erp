# Setup

## Prerequisites
- Node.js 20+
- A Convex account (free tier is fine for development)

## First-time setup

```bash
npm install

# Logs into Convex in your browser, creates/links a dev deployment, and
# writes CONVEX_DEPLOYMENT / NEXT_PUBLIC_CONVEX_URL into .env.local.
npx convex dev
```

Leave that running (it watches `convex/` and pushes functions/schema on
save). In a second terminal, generate and push the Convex Auth JWT keys
(one-time, requires the deployment above to exist):

```bash
npx @convex-dev/auth
```

This writes `JWT_PRIVATE_KEY` / `JWKS` to the Convex deployment's
environment (not to a local file — nothing secret is ever committed).

Then run the Next.js dev server in a third terminal:

```bash
npm run dev
```

Open http://localhost:3000 — you'll land on `/sign-in`. The **first account
you create becomes the Owner** and bootstraps the "NRK Jewellers"
organization, default branch, and boxes 101–200.

## Environment variables

See `.env.example`. Everything else needed by Convex Auth is stored as
Convex deployment environment variables (via `npx convex env set` /
`npx @convex-dev/auth`), not in this repo.
