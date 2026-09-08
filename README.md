# erp_test

A multi-tenant, AI-native ERP platform, starting with the sales workflow
(leads → opportunities → quotes → orders). It is **not** a traditional ERP with a
chatbot bolted on: AI is meant to operate through the same typed, tenant-scoped
service layer the UI uses — never direct database access. Today the repo implements
the **V1 sales core**; the AI/automation layers are still ahead (see
[`.claude/CLAUDE.md`](.claude/CLAUDE.md) §19).

Stack: Next.js (App Router) · TypeScript · tRPC · Drizzle ORM + PostgreSQL · Zod ·
Tailwind + shadcn/ui · Clerk (Organizations = tenants) · Vercel AI SDK.

## Getting started

Prerequisites: Node, Docker, and a Clerk dev instance with **Organizations** enabled.

```bash
docker compose up -d          # Postgres + the restricted `erp_app` role RLS needs
cp .env.example .env.local     # then fill in the Clerk keys
npm install
npm run db:migrate
npm run dev                     # http://localhost:3000
```

`.env.local` needs `DATABASE_URL` (app → `erp_app` role), `MIGRATIONS_DATABASE_URL`
(migrations → owner role), `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and
optionally `OPENAI_API_KEY`. The DB URLs in `.env.example` already match `docker-compose.yml`.

**New here? Read [`docs/WALKTHROUGH.md`](docs/WALKTHROUGH.md)** for a click-by-click tour of
the sales flow (create org → account → product → lead → opportunity → quote → won → order).

## Project layout

| Path | What |
| --- | --- |
| `app/` | Next.js App Router routes (UI + a few route handlers) |
| `lib/services/` | Business logic, one module per aggregate — the only place that touches the DB |
| `lib/db/` | Drizzle schema, migrations, client, tenant-context helper |
| `lib/trpc/` | tRPC router/procedures (thin — validate, resolve tenant, call a service) |
| `lib/ai/` | Vercel AI SDK usage (currently just CSV column-mapping) + tool-call audit log |
| `lib/auth/` | Clerk session → internal tenant/user/role resolution |
| `components/` | Shared React/shadcn components |
| `e2e/` | Playwright specs (run serially against a shared Clerk dev instance) |

Architecture decisions and their rationale live in [`.claude/CLAUDE.md`](.claude/CLAUDE.md) —
keep it in sync with the code.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run typecheck` | `tsc --noEmit` (Vitest does not type-check — run this before calling a change done) |
| `npm test` / `npm run test:watch` | Vitest unit/integration suites |
| `npm run test:e2e` | Playwright end-to-end suites |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` | Apply migrations |
| `npm run db:studio` | Drizzle Studio |
