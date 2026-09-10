# CLAUDE.md — erp_test

Persistent context for Claude Code sessions working on this repository. Read this before making architectural decisions or adding dependencies. If something here conflicts with what you find in the code, the code wins — update this file to match reality.

## 1. Project Vision

`erp_test` is a multi-tenant, AI-native ERP platform, starting with the sales workflow (leads → opportunities → quotes → orders). It is explicitly **not** a traditional ERP with a chatbot bolted on. AI is an operational layer that understands a tenant's sales process (via configuration, not hardcoded per-customer logic) and can eventually help configure, operate, and analyze it — but always through the same controlled, typed service layer a human-driven UI uses, never through direct database access.

The long-term differentiator is **implementation speed**: getting a company from signup to a working, tailored ERP in days instead of the weeks/months a traditional ERP rollout takes. That end-state ("AI reads your data/docs and proposes your whole configuration") is a multi-year target (see Roadmap, V5) — do not build toward it prematurely. The near-term differentiator is a genuinely configurable sales core plus a *human-approved* AI-assisted setup flow.

## 2. Product Principles

- **Configuration over code.** Per-tenant differences (pipeline stages, custom fields, terminology, approval thresholds, roles) must be expressible as data, not as source-code branches or per-customer deploys.
- **AI proposes, humans dispose — for anything consequential.** No V1/V2 AI action should silently mutate system-of-record data. Use the `Suggestion` (proposed-change) primitive for anything beyond trivial, reversible, low-risk actions.
- **Prove the core loop before generalizing.** Don't build a generic workflow engine, generic RBAC, or a generic integrations framework speculatively. Build the narrowest thing that solves the current version's use case; generalize only when a second concrete need appears.
- **Multi-tenant from day one**, not retrofitted. Every table, query, job, and AI tool call assumes and enforces a tenant boundary.
- **Vertical-agnostic today, but don't over-invest in horizontal flexibility before V1 has real users.** Field/pipeline configurability should be generic enough to not require code changes, but resist building configuration abstractions no current use case needs.

## 3. Technical Stack

- **Frontend:** Next.js (App Router) + React + TypeScript + Tailwind CSS + shadcn/ui.
- **API layer:** tRPC, mounted inside the Next.js app. No separate backend service. Rationale: one deployable, end-to-end type safety from DB to UI, and it's the natural place for AI tools to call the exact same procedures the UI calls.
- **Database:** PostgreSQL, accessed via Drizzle ORM. Migrations via drizzle-kit.
- **Validation:** Zod, on every tRPC input and every AI tool input — the same schema, not a duplicate looser one for AI.
- **AI:** Vercel AI SDK for model calls and tool-calling, using `@ai-sdk/openai` as the model provider (`OPENAI_API_KEY`, optional in dev — see `lib/ai/csv-mapping.ts`). Do not adopt LangGraph.js (or any stateful multi-agent orchestrator) until an actual V3-era use case (a proactive operational agent needing branching, resumable multi-step state) requires it. Until then, AI usage is single-shot structured output or a simple tool-calling loop.
  - **Model selection is centralized in `lib/ai/model.ts`** (`defaultModel()`), the single place any V2 AI feature picks a model. `AI_MODEL` env var overrides the default (`gpt-4o-mini`) without a code change; swapping providers later touches only this file.
  - Every AI tool call is logged to `ai_tool_invocations` (tenant, user, tool name, arguments, result) via `lib/ai/audit.ts`'s `logAiToolInvocation` — this satisfies the §8 hard rule and is the one audit mechanism for AI calls; extend it for future AI tools rather than inventing a second one. The V2 AI modules (`lib/ai/drafting.ts`, `lib/ai/setup-wizard.ts`) already call it — follow that.
  - Established pattern for AI-assisted flows (first used for CSV import, Step 11; now also the setup wizard and drafting): the deterministic/manual path must work completely on its own — AI only pre-fills a suggestion. If the model call fails or no API key is configured, catch it and fall back to an empty/manual/template result rather than failing the request. Never make a user-facing flow hard-depend on a live model call succeeding.
  - **Context sent to the model carries no ids and no `tenant_id`.** `lib/services/draft.ts` / `lib/services/setup-wizard.ts` assemble a plain-text context object from tenant-scoped service reads, and the `lib/ai/*` functions receive only that.
- **Async/scheduled work:** decided (V2) — a Postgres-backed job table (`automation_runs`, which doubles as the audit trail) drained by **Vercel Cron** (`vercel.json` → `GET /api/cron/automation`, shared-secret auth via `CRON_SECRET`, every 15 min). Runner lives in `lib/automation/`. This is the "simplest thing that works" tier; move to Inngest only when a rule genuinely needs durable multi-day step state (multi-day approval waits — expected V3). Do not reach for Temporal or a bespoke workflow engine.
- **Email:** outbound email via **Resend** (`resend` package, `RESEND_API_KEY` + `RESEND_FROM_ADDRESS`, both optional — `lib/services/email.ts` throws a typed `PRECONDITION_FAILED` when unset). Every send is recorded in `email_messages` (the audit trail for a customer-facing action, §8). Sending is triggered only by a human on their own reviewed draft or by approving a `send_follow_up_email` Suggestion — never automatically.
- **Search:** pgvector inside the existing Postgres instance for anything needing embeddings (unstructured content only — see §9). No separate vector database until scale genuinely demands it.
- **File storage:** S3-compatible object storage (e.g. Cloudflare R2 or S3) for imports/attachments.
- **Deployment:** Vercel for the app; managed Postgres (e.g. Neon) for the database.
- **Auth:** Clerk, using Clerk Organizations as the `Tenant` concept. Decided in the Step 2 implementation session — see §7 for the sync/RLS pattern.
  - **Roles map from the Clerk org role on every request** (`mapClerkOrgRole` in `lib/auth/session.ts`): `org:admin` → `admin`, custom `org:sales_manager` → `sales_manager`, everything else → `sales_rep`. `syncMembership` upserts the membership row and keeps its role in sync with Clerk on each request — Clerk is the source of truth, a dashboard role change propagates on the member's next request (an earlier version only set the role on first sight).
  - The installed `@clerk/nextjs` (7.x, "Core 3") has **removed** the `<SignedIn>`/`<SignedOut>`/`<Protect>` control components entirely — importing and rendering them compiles fine but throws at request time (`Clerk: <X> is not available in @clerk/nextjs Core 3`). Do not reach for them from memory/training data. Check auth conditionally by calling `auth()` from `@clerk/nextjs/server` in a Server Component (`const { userId } = await auth()`) and branching in plain JSX instead — this is also what every page already does via `auth.protect()`, so it's the established pattern, not a workaround.

This is a **single Next.js application at the repo root** — not a monorepo. Keep internal module boundaries clean (`lib/services/*`, `lib/ai/*`, `lib/db/*`, `lib/trpc/*`) so a future split is possible, but don't introduce workspace tooling before there's a second deployable that actually needs it.

## 4. Architecture Principles

```
Next.js App (UI, RSC)
        │  typed calls
   tRPC Router (Zod-validated input)
        │
        ├──► Business Services (one per aggregate: Opportunity, Quote, Lead, Account, ...)
        │        │  tenant-scoped, Zod-validated, audited
        │        ▼
        │    Drizzle ORM → Postgres (tenant_id on every tenant table + RLS policy)
        │
        ├──► AI Tool Layer (Vercel AI SDK tools — thin wrappers that call the SAME
        │        business services above; never a parallel/shortcut data path)
        │
        └──► Job Runner (trigger/condition/action rows; async + scheduled work)
```

**Hard rule: AI never queries Postgres directly and never receives `tenant_id` as a model-controlled argument.** Tenant context is always derived server-side from the authenticated session/request and injected before any service call — never accepted as input from a tool call or a client.

**Hard rule: business logic lives in services, not in tRPC procedures or React components.** tRPC procedures should be thin — validate input, resolve tenant/user context, call a service, return the result. AI tools should be equally thin wrappers around the same services.

**Server-derived identity: `ActorContext` (`lib/auth/actor.ts`)** — `{ tenantId, userId, role }`, the one shape every service/tool call runs as. `SessionContext` (`lib/auth/session.ts`) is the request-scoped instance for the signed-in user; automation runs as `systemActor(tenantId)` (`lib/automation/actions.ts`) with `userId = SYSTEM_ACTOR_USER_ID` (a sentinel, never inserted into `users` — FK columns store `null` for it) and `role = "admin"`. Services that need a role check take the full `ActorContext`, not just `tenantId`.

**Role enforcement is layered** (fixed role set `admin | sales_manager | sales_rep`, §17 — do not build a general permissions engine):
- `roleProcedure([...])` / `managerProcedure` / `adminProcedure` in `lib/trpc/procedures.ts` gate tRPC procedures.
- `requireRole(role, allowed)` in `lib/auth/authorize.ts` is called **inside services** too, because AI tools and automation reach services directly and must be gated identically. The `Suggestion` registry enforces a per-kind required role this way.
- `requirePage(allowed?)` in `lib/auth/page-guard.ts` is UX only — it renders an access-denied state so a mistargeted link is legible; the tRPC/service layer is the actual enforcement. Sidebar nav gating (`app-sidebar.tsx`) is cosmetic.

## 5. Repository Structure

```
app/                    Next.js App Router routes (UI + route handlers)
lib/
  trpc/                 tRPC router setup, procedure definitions (thin)
  services/             Business logic, one module per aggregate (opportunity.ts, quote.ts, ...)
  db/                    Drizzle schema, migrations, client
  ai/                    Vercel AI SDK tool definitions, prompt/context assembly, model selection (model.ts)
  automation/            Declarative-automation engine: triggers, conditions, action handlers, cron runner (V2, §10)
  config/                Tenant configuration helpers (pipelines, custom fields, terminology)
  auth/                  Auth/session helpers, tenant resolution, ActorContext, role checks, page guard
components/             Shared React/shadcn components
```

(This structure grew through V1 and is now growing through V2 — treat the above as the current shape, kept roughly in sync with the tree.)

## 6. Domain Concepts (V1 target)

Core entities: `Tenant` (Company), `User`, `Membership` (User↔Tenant↔Role), `Role`, `Account`/`Customer`, `Contact`, `Lead`, `Opportunity`, `PipelineStage` (tenant-configurable, ordered rows — not an enum), `Product`, `Quote`, `QuoteLineItem`, `Order` (stub in V1), `Activity`, `Task`, `CustomFieldDefinition`, `CustomFieldValue`, `Suggestion` (the approval primitive — see §9), `AuditLogEntry`, `Attachment`.

**V2 entities now in the tree** (schema + service + router + UI, working tree per §18):
- `Suggestion` (`lib/db/schema/suggestion.ts`) — the approval primitive, **built**. `source` (setup_wizard | automation | ai_assist | manual) × `kind` (a fixed enum) × `status` (pending | approved | rejected | superseded), a Zod-validated JSONB `payload`, optional polymorphic `targetEntity*`, and `groupKey` for batch ("approve all") review. `lib/services/suggestion.ts`'s `KIND_REGISTRY` is the only place that maps a kind → { payload schema, required role(s), `describe()`, `apply()` that calls exactly one existing service }. Adding a kind = one enum value + one registry entry.
- `Draft` (`lib/db/schema/draft.ts`) — AI-drafted text a human reviews: `opportunity_summary` | `account_summary` | `follow_up_email`. Persisted so an automation can produce one with no user in the request and so edits survive a reload. `model` is null when the deterministic template fallback ran.
- `EmailMessage` (`lib/db/schema/email.ts`) — a record of every email the ERP sent via Resend; the audit trail for a customer-facing action.
- `AutomationRule` + `AutomationRun` (`lib/db/schema/automation.ts`) — see §10. `automation_runs` doubles as the job queue and the audit trail.

**`AuditLogEntry` and `Attachment` are still not built** — no schema, service, or router. `ai_tool_invocations` covers AI-call audit and `email_messages` / `automation_runs` cover their own; a general audit log is still backlog. Build only when a concrete need names it, per §17.

Key relationships:
- `Tenant` 1–N everything; every tenant-owned table carries `tenant_id`.
- `Account` 1–N `Contact`; `Account`/`Contact` 1–N `Lead`; `Lead` converts to `Opportunity`.
- `Opportunity` N–1 `PipelineStage`; 1–N `Activity`, `Task`, `Quote`.
- `Quote` 1–N `QuoteLineItem` N–1 `Product`; `Opportunity` (Won) → 1 `Order`.
- `CustomFieldDefinition` N–1 `Tenant` + entity type; `CustomFieldValue` N–1 definition + polymorphic target record.
- `Suggestion` N–1 `Tenant`, references a target entity + a proposed diff + an approving `User`.
- `AutomationRule` 1–N `AutomationRun`; a run may produce one `Suggestion` and/or one `Draft` (`resultSuggestionId` / `resultDraftId`, no FK).
- `Draft` polymorphic → `Opportunity` | `Account`; `EmailMessage` polymorphic → `Draft` / `Opportunity` / `Contact` (no FKs — kept for audit even if the target is deleted).

Custom fields: a metadata table (`CustomFieldDefinition`: tenant, entity type, name, field type, options, required) plus a JSONB value column on `CustomFieldValue`. Deliberately **not** full EAV — worse query performance for no V1 benefit. Field types are a small fixed set (text, number, date, select, boolean); don't generalize further until a real need appears.

## 7. Multi-Tenancy

- Shared Postgres schema (not schema-per-tenant, not DB-per-tenant) — revisit only if a specific enterprise customer contractually requires physical isolation.
- Every tenant-owned table: `tenant_id NOT NULL REFERENCES tenants(id)`.
- Postgres Row-Level Security policies (`tenant_id = current_setting('app.tenant_id')::uuid`) as **defense-in-depth underneath** app-level scoping — RLS is a backstop, not a substitute for scoping every query explicitly at the service layer.
- A request-scoped middleware resolves the tenant from the authenticated session and sets it before any query runs. Background jobs and AI tool calls must carry an explicit tenant context too — nothing ever runs tenant-less.
- **Never trust a client-, tool-, or model-supplied tenant identifier.** It is always derived server-side.
- **Implementation note:** `tenants`/`users` are not tenant-owned tables themselves (a user can belong to multiple tenants; a tenant's own row can't be scoped by itself) — RLS starts at `memberships` and every table after it. Tenant/user rows are synced from Clerk org/user on first sight (`lib/auth/session.ts`); Clerk org ↔ `tenants.clerkOrgId`, Clerk user ↔ `users.clerkUserId`. The membership **role** is re-synced from the Clerk org role on every request (`syncMembership`, upsert) — not just on first sight — so a role change in the Clerk dashboard takes effect on the member's next request.
- **Implementation note:** the app's Postgres connection (`DATABASE_URL`) must be a non-superuser role. The default `POSTGRES_USER` on the official Postgres image is a superuser, and superusers always bypass RLS even with `FORCE ROW LEVEL SECURITY` — migrations run as the owner role (`MIGRATIONS_DATABASE_URL`), the app/tests connect as a separate restricted role (see `docker/postgres-init/001-app-role.sql`). Any new tenant-owned table's migration needs its own `ENABLE`/`FORCE ROW LEVEL SECURITY` + `CREATE POLICY` (pattern in `lib/db/migrations/0001_memberships_rls.sql`) — default privileges on the restricted role make this automatic for grants, but not for RLS policies themselves.

## 8. Security Principles

- Tenant isolation is a correctness requirement, not a nice-to-have — treat any code path that queries tenant data without an explicit, server-derived tenant filter as a bug regardless of whether it's currently exploitable.
- Every AI tool call is logged (tool name, arguments, tenant, acting user, result) for audit.
- Consequential AI-triggered or automation-triggered actions (stage changes, deletions, anything customer-facing like sending an email) go through the `Suggestion` approval primitive, not direct application — see §9.
- Use the same Zod schema to validate both human-driven (tRPC) and AI-driven (tool) calls into a service — never a looser schema for AI.
- Secrets/env vars: never commit `.env*` files (already gitignored).

## 9. AI Principles

**Flow:** `AI → Tools (Zod-validated, thin wrappers over business services) → Business Services (tenant scope + business rules) → Authorization/Validation → Database.` Never `AI → SQL → Database`.

**What AI is for (genuine value):**
- Unstructured-to-structured mapping (e.g., CSV column → field mapping during import).
- Summarization (activity history → account/opportunity summary).
- Free-text drafting (follow-up emails, quote notes).
- Classification with rationale (lead scoring, sentiment).
- NL analytics Q&A — but only once a stable metrics layer exists underneath it (V4+, not before).

**What AI is explicitly NOT for:**
- Authorization/permission decisions.
- Financial calculations (quote totals, tax) — these must be deterministic code.
- Anything requiring guaranteed determinism for compliance/audit.
- Unattended writes to system-of-record fields.
- Deciding time-based/threshold conditions ("has it been 7 days," "is value > €50,000") — these are plain scheduled jobs/queries, not LLM calls, even though the *rule that triggers them* may have been defined via natural language during setup.

**Approval primitive (`Suggestion`):** the one generic mechanism for "AI or an automation proposes, a human approves." **Built** in `lib/db/schema/suggestion.ts` + `lib/services/suggestion.ts`. Reused by: the setup wizard (`createSetupSuggestions`), automation actions (`propose_opportunity_stage_change`), and — pattern-ready — future agents. Extend it by adding a `suggestion_kind` enum value + a `KIND_REGISTRY` entry (Zod payload schema, required role(s), `describe`, `apply` calling one existing service). Do not invent a second approval mechanism. `approve` validates the payload against the kind schema again and runs `apply()` as the approving actor; `approveGroup(groupKey)` does a batch. Nothing exposes "create an arbitrary suggestion" as a procedure — only services create them.

**AI-assisted flows now built (V2):**
- **Setup wizard** (`lib/ai/setup-wizard.ts` → `lib/services/setup-wizard.ts` → `setupWizard` router, manager+): single-shot structured extraction over a CSV sample proposes pipeline stages + custom fields; `createSetupSuggestions` turns the accepted proposal into a `groupKey`-batched set of `Suggestion` rows. Model optional — falls back to the standard default stages not yet present, and an empty field list.
- **Drafting** (`lib/ai/drafting.ts` → `lib/services/draft.ts` → `draft` router): `opportunity_summary` / `account_summary` and `follow_up_email` drafts. `lib/services/draft.ts` assembles the context deterministically from tenant-scoped reads (opportunity, stage, activities, tasks, contact) — no ids reach the model. Every path has a template fallback; `Draft.model` records which model ran, or null for the fallback.
- **Assist panel** (`components/assist-panel.tsx`) surfaces summaries on the opportunity/account detail pages.

**Company-specific AI context:** assembled deterministically from the tenant's own configuration tables (pipeline, fields, terminology, rules) and injected into prompts — see `lib/services/draft.ts` and `lib/services/setup-wizard.ts` for the pattern. Reserve embeddings/vector search (pgvector) for genuinely unstructured content (uploaded docs, email threads) — do not vectorize structured business configuration that could just be queried.

**Agents:** V1/V2 need no autonomous multi-step agents — single-shot structured output or a simple tool-calling loop covers setup-assist and drafting. Don't adopt agent-orchestration frameworks (LangGraph.js or similar) until a concrete V3-era need (a proactive operational agent with branching, resumable state) exists.

## 10. Workflow Principles

- Automation is expressed as **declarative rows**: trigger type + JSON conditions + a fixed enum of known action handlers. Not a general DSL, not a visual-programming graph, not a Turing-complete engine.
- Some rules need multi-day durability (e.g., "wait for manager approval") — use a durable execution primitive (Inngest step functions or a simple state-machine table + cron) for that, starting in V2. Keep the *definition* language minimal regardless of the execution mechanism.
- If a requested automation can't be expressed as trigger→condition→action, that's a signal to say no or scope it down — not a signal to build a bigger engine.

**V2 implementation (`lib/db/schema/automation.ts` + `lib/services/automation.ts` + `lib/automation/*` + `automation` router, manager+; UI at `/settings/automation`):**
- `automation_rules`: `trigger` (`opportunity_stage_changed` | `opportunity_created` | `opportunity_idle`) × strict per-trigger JSONB `conditions` × `action` (`create_task` | `propose_opportunity_stage_change` | `draft_follow_up_email`) × strict per-action JSONB `actionConfig` × `enabled`. `createRuleInput` is a discriminated union on `trigger`; `actionConfig` is validated separately against the chosen action (`lib/automation/actions.ts`).
- `automation_runs`: the job queue **and** the audit trail. `dedupeKey` is unique per `(tenant, rule, entity, occurrence)` so a trigger can't double-fire. Statuses `pending → running → succeeded|failed|skipped`, `MAX_ATTEMPTS = 3`.
- **Event triggers** are dispatched best-effort from the mutating service — `dispatchTrigger(...)` in `moveOpportunityToStage` and `convertLeadToOpportunity`. It owns its errors and never throws into the caller (a failed automation must not fail the stage move that caused it).
- **Scheduled trigger** (`opportunity_idle`): the cron route's `enqueueScheduledRuns()` finds idle opportunities in pure SQL (no LLM — §9) and inserts day-bucketed runs; `drainPendingRuns()` executes them.
- **Condition evaluation is a tiny fixed evaluator** (`lib/automation/conditions.ts`) — one strict Zod schema per trigger, no arbitrary expressions.
- **Consequentiality:** `create_task` and `draft_follow_up_email` apply directly (low-risk / draft-only); `propose_opportunity_stage_change` creates a `Suggestion`. Runs execute as `systemActor(tenantId)`.

## 11. Coding Conventions

- TypeScript everywhere, strict mode on (already set in `tsconfig.json`). No `any` as an escape hatch — if a type is genuinely unknown, model it explicitly.
- Business logic in `lib/services/*`, one module per aggregate. tRPC procedures and AI tools are both thin callers into these — logic should not be duplicated between them.
- Prefer explicit, narrow types over generic/config-driven type gymnastics. The custom-field system stores dynamic data (JSONB), but the code that reads/writes it should have a concrete, narrow TypeScript interface, not `any`/`Record<string, unknown>` leaking into business logic.
- No premature abstraction: three similar service functions are fine; don't extract a generic "CRUD service factory" until a third or fourth aggregate makes the duplication actually costly.
- Frontend/UI work (new pages, components, layout, styling) must use the `frontend-design` skill — invoke it before writing UI code, not after.

## 12. Database Conventions

- Drizzle schema files per aggregate, mirroring `lib/services/*`.
- Every tenant-owned table has `tenant_id` as the first non-PK column, `NOT NULL`, with an FK to `tenants`, and an RLS policy.
- Prefer normalized relational tables for anything with real structure (pipeline stages, roles); JSONB only for genuinely dynamic/tenant-defined values (custom field values).
- Migrations via drizzle-kit; never hand-edit generated migration files after they've been applied anywhere.
- **Two-file migration pattern for a new tenant-owned table:** (1) `npm run db:generate` produces the machine-named `CREATE TABLE` migration + `meta/<n>_snapshot.json` + a `_journal.json` entry; (2) hand-write the next-numbered `<n+1>_<name>_rls.sql` with `ENABLE`/`FORCE ROW LEVEL SECURITY` + `CREATE POLICY "tenant_isolation" ON <t> USING ("tenant_id"::text = current_setting('app.tenant_id', true))`, and **manually append its `_journal.json` entry** (`idx`+1, `when`+1ms, `tag` = filename without `.sql`, `breakpoints: true`; no snapshot json for the hand-written file). No GRANTs needed — default privileges on `erp_app` cover new tables. Examples: `0018`+`0019`, `0020`+`0021`, `0022`+`0023`.
- Soft-delete vs hard-delete: default to soft-delete (`deleted_at`) for customer-facing records (accounts, opportunities, quotes) since audit history matters here; hard-delete is fine for ephemeral/derived data (e.g. `quote_line_items` — they're components of their parent quote, not independently meaningful records).
- Money columns are `numeric(12,2)` (exact, not `float`/`double`), stored and passed across the wire as decimal strings (e.g. `"19.99"`). Never do arithmetic on them via `parseFloat`/JS `number` multiplication — convert to integer cents first (see `lib/services/quote.ts`'s `priceToCents`/`centsToPrice`), do the arithmetic in cents, convert back. This is what makes financial calculations actually deterministic per §9, not just "not literally calling an LLM."
- Line items that reference a catalog record with a price (e.g. `quote_line_items.unitPrice` against `products.unitPrice`) snapshot the price at the time the line item is created rather than joining live — editing a product's catalog price must never retroactively change the total on an existing quote.

## 13. API Conventions

- All application data access goes through tRPC procedures — no ad hoc Next.js route handlers for CRUD that could be a procedure instead. Route handlers are reserved for things tRPC doesn't fit (webhooks, file uploads, OAuth callbacks, and the cron trigger `app/api/cron/automation/route.ts` — shared-secret auth, no session).
- Procedure inputs/outputs are Zod schemas; reuse the same schema for the equivalent AI tool definition rather than duplicating it.
- Procedures resolve tenant + user context from the session before calling into a service — never pass tenant/user identifiers as client-supplied input fields.

## 14. Testing Expectations

- Multi-tenant isolation is the highest-priority thing to test: for any new query/service method, add a test asserting it cannot return or mutate another tenant's data even when given a valid-looking ID for a different tenant.
- Business services (the aggregate logic) should have unit tests independent of tRPC/UI.
- AI tools should be tested for the *service calls they trigger*, not for "does the LLM say the right thing" — mock the model, assert the tool correctly validates input and calls the expected service with the expected (tenant-scoped) arguments.
- Run `npm run typecheck` (`tsc --noEmit`) before considering a step done — Vitest transpiles with esbuild and does not type-check, so it will happily pass against code with real type errors.
- E2E tests touching auth must use `@clerk/testing/playwright` (`clerkSetup()` in Playwright's `globalSetup`, `clerk.signIn({ page, emailAddress })` to authenticate) rather than driving Clerk's hosted sign-up form directly — the form's Cloudflare Turnstile bot-protection script cannot be automated reliably (and may not even be network-reachable in a sandboxed environment). Provision test users via the Backend API (`createClerkClient({ secretKey })`) and delete them in a `finally` block. Reuse the shared helpers in `e2e/support/clerk-test-user.ts` rather than duplicating this setup per spec.
- Playwright is configured to run **serially** (`fullyParallel: false`, `workers: 1`) — every e2e test signs in against the same shared Clerk dev instance, which has strict rate limits, and parallel workers cause flaky failures under load (confirmed empirically: an accounts test failed at 4 workers, passed consistently at 1). Don't re-parallelize without a different Clerk strategy (e.g. per-worker instances).
- Playwright selector pitfalls seen in this repo, worth avoiding proactively in new specs:
  - Don't `.check()`/`.uncheck()` a checkbox whose `checked` state is driven by a tRPC mutation (controlled input, no optimistic update) — the native DOM toggles on click but React reverts it on re-render before the mutation resolves, so Playwright's built-in "did the state actually change" verification fails. Use `.click()` and assert on the resulting UI state (e.g. a class change) instead.
  - Don't `getByText(stageName)` when a pipeline stage name can also appear elsewhere on the page (e.g. as an `<option>` in a "move to stage" `<select>`) — it trips strict-mode "resolved to N elements." Scope with `getByRole("heading", { name: ... })` or a container `data-testid` instead.
  - Don't `page.reload()`/`page.goto()` right after clicking a button that fires a mutation — Playwright's `.click()` returns as soon as the click event dispatches, not once the underlying request resolves, so navigating away can abort it mid-flight and the write silently never happens. Wait for a UI signal that the mutation actually completed first (a success message, an invalidated query changing the DOM, a button re-disabling) before navigating.

## 15. Error-Handling Expectations

- Validate at boundaries (tRPC input, AI tool input) with Zod; trust internal service-to-service calls that already received validated data.
- Business-rule violations (e.g., "quote requires approval above threshold") should be typed, expected errors surfaced clearly to the caller — not generic exceptions.
- AI tool calls that fail validation or a business rule should return a structured failure the model can react to (e.g., ask for clarification or produce a `Suggestion` instead), not throw an unhandled exception into the chat loop.

## 16. How AI Agents/Tools Should Interact With the ERP

1. A tool is a thin, Zod-validated wrapper around exactly one business service call.
2. The tool never accepts `tenant_id` (or any tenant-scoping parameter) from the model — it's injected from the caller's server-side context.
3. If the underlying service call is consequential (mutates system-of-record data, sends anything externally, deletes anything), the tool creates a `Suggestion` for human approval instead of calling the service directly, unless the action has already been explicitly pre-approved by policy (e.g., a low-risk, reversible action a tenant has opted into auto-applying).
4. Every tool invocation is logged: tool name, arguments, tenant, acting user/session, and result.
5. Tools must not expose raw query/filter capability to the model (no "run this SQL," no "fetch arbitrary table") — only the specific, named operations a business service exposes.

## 17. Things We Explicitly Should NOT Do

- Do not let AI write directly to the database or accept model-supplied `tenant_id`.
- Do not build a general-purpose workflow DSL, visual workflow builder, or Turing-complete rule engine.
- Do not implement full EAV for custom fields.
- Do not build a generalized custom-roles/permissions engine before a real customer needs more than the fixed V1 role set (Admin, Sales Manager, Sales Rep).
- Do not adopt LangGraph.js or any multi-agent orchestration framework before a concrete V3-era need exists.
- Do not build an integrations marketplace/generic connector framework before there are 2–3 real integrations proving the pattern.
- Do not build the NL analytics agent before a stable, trustworthy metrics layer exists underneath it.
- Do not promise or build full autonomous "AI configures your whole ERP unsupervised" — every configuration change AI proposes goes through human approval, indefinitely, unless a future decision explicitly and narrowly revisits this for specific low-risk action types.
- Do not introduce a monorepo/workspace tooling before there's a second deployable that needs to share packages with this app.

## 18. Development Workflow

- **V1 is complete** as of the 12-step sequence (tooling → auth/tenant → authorization → accounts/contacts → pipeline → leads → opportunities/activities/tasks → products/quotes → won/lost/order stub → custom fields → CSV import → pipeline dashboard), each implemented and tested (Vitest + Playwright) before the next started. All 12 steps have passing Vitest suites, clean `tsc --noEmit`, and passing Playwright specs. A later design-system pass (visual/IA polish, no new capability) and a V1-completeness pass (closed missing update/delete on Account/Product/Contact/Opportunity/Lead/Quote, added Lead un-convert, a minimal `/orders/[id]` page, custom-field value clear + definition rename, search+pagination on Accounts/Leads/Products, app-wide toast/validation feedback, and — closing the one gap that pass had deliberately deferred — a `quote.list` procedure + `/quotes` index page with search/pagination and a sidebar entry) both landed after the original 12 steps — see git history for exact scope.
- **V2 is in progress** — landed in the working tree (migrations `0018`–`0023`; not all committed yet, so check `git status` / the tree, not just git log). Scope so far: (1) **role-based authorization enforcement** — `sales_manager` role, `roleProcedure`/`managerProcedure`/`adminProcedure`, `requireRole` in services, `requirePage` guard, config surfaces (pipeline, custom fields, products, automation, guided setup) moved to manager+; (2) the **`Suggestion` approval primitive** (`/suggestions` inbox, sidebar pending-count badge); (3) the **AI setup wizard** (`/setup`); (4) **AI drafting** — opportunity/account summaries + follow-up emails (assist panel on detail pages); (5) **outbound email via Resend** (`email_messages` audit); (6) **declarative automation** — rules + cron-driven runner (`/settings/automation`, `vercel.json` cron). `tsc --noEmit` is clean; each area has Vitest suites (`lib/services/*.test.ts`, `lib/ai/*.test.ts`, `lib/trpc/routers/rbac.test.ts`) and Playwright specs (`e2e/rbac.spec.ts`, `suggestions.spec.ts`, `setup-wizard.spec.ts`, `opportunity-assist.spec.ts`). `docs/WALKTHROUGH.md` still describes V1 only and lags this.
- Before extending V2 or starting V3, check what's actually been built (tables in `lib/db/schema/`, routes in `app/`, routers in `lib/trpc/routers/_app.ts`) rather than assuming from this doc alone, since it can lag the code.
- When adding a new aggregate (e.g., `Opportunity`), add in this order: Drizzle schema (with `tenant_id` + RLS) → service module → tRPC procedures → (if applicable) AI tool wrapper → UI.
- Keep this file up to date as decisions change — if an open question below gets answered, move it into the relevant section above and remove it from Open Questions.

## 19. Roadmap

- **V0 — Foundation:** repo/infra, auth, tenant + membership model, empty shell UI. Nothing sales-domain yet.
- **V1 — Sales Core:** configurable CRM (leads/opportunities/quotes/pipeline/accounts/contacts/activities/tasks), tenant-configurable pipeline + custom fields, CSV import with AI-assisted column mapping (human-approved).
- **V2 — Guided Setup & Assist (in progress):** AI setup wizard proposing pipeline/fields from imported data, the `Suggestion` approval primitive, first deterministic automation rules, AI email/summary drafting, role-based authorization. See §18 for landed scope.
- **V3 — Operational Agent:** tool-calling agent surfacing at-risk/stale opportunities and drafting recommended actions; durable execution for multi-day approval chains.
- **V4 — Analytics & Forecasting:** stable metrics layer + NL analytics agent over it, pipeline health/forecasting.
- **V5 — Expanded Implementation Agent & Integrations:** deeper "connect existing systems," more autonomous onboarding from arbitrary docs/CRMs, integrations beyond CSV/email, inventory/order completion. This is the full "self-implementing ERP" vision — only attempt once V1–V4 have proven the config model and AI-trust pattern on real customers.

## 20. Open Questions (unresolved — do not assume an answer)

1. Target vertical: stay horizontal SMB, or focus V1–V2 on a specific vertical (e.g., quote-heavy B2B distribution/manufacturing)?
2. Pricing model (seat-based vs. usage-based) — affects whether AI features need metering/gating from V1, since compute cost scales with usage.
3. Data residency/compliance target (e.g., EU/GDPR) — affects hosting region choice; should be decided before infra is provisioned, not retrofitted.
4. Appetite for design partners/early customers to validate the "AI proposes configuration" assumption before over-investing in that flow.
5. Team size/solo — affects how aggressively the roadmap should be sequenced vs. parallelized.

## 21. Future Architectural Considerations (not decided, revisit later)

- Splitting into a monorepo if a second consumer (mobile app, public API) needs the same business services.
- Schema-per-tenant or DB-per-tenant if a specific enterprise customer contractually requires physical data isolation.
- A dedicated vector database if pgvector's performance/scale becomes limiting.
- LangGraph.js (or similar) once an agent genuinely needs branching, resumable, multi-step state (expected no earlier than V3).
- A more general workflow definition language only if the flat trigger/condition/action model provably can't express a rule real customers need (branching/loops) — treat this as a high bar, not a default evolution.
