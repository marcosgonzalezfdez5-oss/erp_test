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
- **AI:** Vercel AI SDK for model calls and tool-calling. Do not adopt LangGraph.js (or any stateful multi-agent orchestrator) until an actual V3-era use case (a proactive operational agent needing branching, resumable multi-step state) requires it. Until then, AI usage is single-shot structured output or a simple tool-calling loop.
- **Async/scheduled work:** start with the simplest thing that works (a Postgres-backed job table + cron, or Inngest if the durable-step-function model is needed for multi-day approval waits). Do not reach for Temporal or a bespoke workflow engine.
- **Search:** pgvector inside the existing Postgres instance for anything needing embeddings (unstructured content only — see §9). No separate vector database until scale genuinely demands it.
- **File storage:** S3-compatible object storage (e.g. Cloudflare R2 or S3) for imports/attachments.
- **Deployment:** Vercel for the app; managed Postgres (e.g. Neon) for the database.
- **Auth:** not yet decided — open question, see §14. Do not build a custom auth system without revisiting this.

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

## 5. Repository Structure

```
app/                    Next.js App Router routes (UI + route handlers)
lib/
  trpc/                 tRPC router setup, procedure definitions (thin)
  services/             Business logic, one module per aggregate (opportunity.ts, quote.ts, ...)
  db/                    Drizzle schema, migrations, client
  ai/                    Vercel AI SDK tool definitions, prompt/context assembly
  config/                Tenant configuration helpers (pipelines, custom fields, terminology)
  auth/                  Auth/session helpers, tenant resolution middleware
components/             Shared React/shadcn components
```

(This structure will grow as V0/V1 are implemented — treat the above as the target shape, not a claim that it already exists.)

## 6. Domain Concepts (V1 target)

Core entities: `Tenant` (Company), `User`, `Membership` (User↔Tenant↔Role), `Role`, `Account`/`Customer`, `Contact`, `Lead`, `Opportunity`, `PipelineStage` (tenant-configurable, ordered rows — not an enum), `Product`, `Quote`, `QuoteLineItem`, `Order` (stub in V1), `Activity`, `Task`, `CustomFieldDefinition`, `CustomFieldValue`, `Suggestion` (the approval primitive — see §9), `AuditLogEntry`, `Attachment`.

Key relationships:
- `Tenant` 1–N everything; every tenant-owned table carries `tenant_id`.
- `Account` 1–N `Contact`; `Account`/`Contact` 1–N `Lead`; `Lead` converts to `Opportunity`.
- `Opportunity` N–1 `PipelineStage`; 1–N `Activity`, `Task`, `Quote`.
- `Quote` 1–N `QuoteLineItem` N–1 `Product`; `Opportunity` (Won) → 1 `Order`.
- `CustomFieldDefinition` N–1 `Tenant` + entity type; `CustomFieldValue` N–1 definition + polymorphic target record.
- `Suggestion` N–1 `Tenant`, references a target entity + a proposed diff + an approving `User`.

Custom fields: a metadata table (`CustomFieldDefinition`: tenant, entity type, name, field type, options, required) plus a JSONB value column on `CustomFieldValue`. Deliberately **not** full EAV — worse query performance for no V1 benefit. Field types are a small fixed set (text, number, date, select, boolean); don't generalize further until a real need appears.

## 7. Multi-Tenancy

- Shared Postgres schema (not schema-per-tenant, not DB-per-tenant) — revisit only if a specific enterprise customer contractually requires physical isolation.
- Every tenant-owned table: `tenant_id NOT NULL REFERENCES tenants(id)`.
- Postgres Row-Level Security policies (`tenant_id = current_setting('app.tenant_id')::uuid`) as **defense-in-depth underneath** app-level scoping — RLS is a backstop, not a substitute for scoping every query explicitly at the service layer.
- A request-scoped middleware resolves the tenant from the authenticated session and sets it before any query runs. Background jobs and AI tool calls must carry an explicit tenant context too — nothing ever runs tenant-less.
- **Never trust a client-, tool-, or model-supplied tenant identifier.** It is always derived server-side.

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

**Approval primitive (`Suggestion`):** the one generic mechanism for "AI or an automation proposes, a human approves." Build once, reuse for: setup-wizard configuration proposals, automation-triggered actions, and later agent recommendations. Do not invent a second approval mechanism for a new feature — extend this one.

**Company-specific AI context:** assembled deterministically from the tenant's own configuration tables (pipeline, fields, terminology, rules) and injected into prompts. Reserve embeddings/vector search (pgvector) for genuinely unstructured content (uploaded docs, email threads) — do not vectorize structured business configuration that could just be queried.

**Agents:** V1/V2 need no autonomous multi-step agents — single-shot structured output or a simple tool-calling loop covers setup-assist and drafting. Don't adopt agent-orchestration frameworks (LangGraph.js or similar) until a concrete V3-era need (a proactive operational agent with branching, resumable state) exists.

## 10. Workflow Principles

- Automation is expressed as **declarative rows**: trigger type + JSON conditions + a fixed enum of known action handlers. Not a general DSL, not a visual-programming graph, not a Turing-complete engine.
- Some rules need multi-day durability (e.g., "wait for manager approval") — use a durable execution primitive (Inngest step functions or a simple state-machine table + cron) for that, starting in V2. Keep the *definition* language minimal regardless of the execution mechanism.
- If a requested automation can't be expressed as trigger→condition→action, that's a signal to say no or scope it down — not a signal to build a bigger engine.

## 11. Coding Conventions

- TypeScript everywhere, strict mode on (already set in `tsconfig.json`). No `any` as an escape hatch — if a type is genuinely unknown, model it explicitly.
- Business logic in `lib/services/*`, one module per aggregate. tRPC procedures and AI tools are both thin callers into these — logic should not be duplicated between them.
- Prefer explicit, narrow types over generic/config-driven type gymnastics. The custom-field system stores dynamic data (JSONB), but the code that reads/writes it should have a concrete, narrow TypeScript interface, not `any`/`Record<string, unknown>` leaking into business logic.
- No premature abstraction: three similar service functions are fine; don't extract a generic "CRUD service factory" until a third or fourth aggregate makes the duplication actually costly.

## 12. Database Conventions

- Drizzle schema files per aggregate, mirroring `lib/services/*`.
- Every tenant-owned table has `tenant_id` as the first non-PK column, `NOT NULL`, with an FK to `tenants`, and an RLS policy.
- Prefer normalized relational tables for anything with real structure (pipeline stages, roles); JSONB only for genuinely dynamic/tenant-defined values (custom field values).
- Migrations via drizzle-kit; never hand-edit generated migration files after they've been applied anywhere.
- Soft-delete vs hard-delete: default to soft-delete (`deleted_at`) for customer-facing records (accounts, opportunities, quotes) since audit history matters here; hard-delete is fine for ephemeral/derived data.

## 13. API Conventions

- All application data access goes through tRPC procedures — no ad hoc Next.js route handlers for CRUD that could be a procedure instead. Route handlers are reserved for things tRPC doesn't fit (webhooks, file uploads, OAuth callbacks).
- Procedure inputs/outputs are Zod schemas; reuse the same schema for the equivalent AI tool definition rather than duplicating it.
- Procedures resolve tenant + user context from the session before calling into a service — never pass tenant/user identifiers as client-supplied input fields.

## 14. Testing Expectations

- Multi-tenant isolation is the highest-priority thing to test: for any new query/service method, add a test asserting it cannot return or mutate another tenant's data even when given a valid-looking ID for a different tenant.
- Business services (the aggregate logic) should have unit tests independent of tRPC/UI.
- AI tools should be tested for the *service calls they trigger*, not for "does the LLM say the right thing" — mock the model, assert the tool correctly validates input and calls the expected service with the expected (tenant-scoped) arguments.

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

- This is currently pre-V0: a bare Next.js scaffold, no domain code yet. Do not scaffold sales-domain tables/services/routers speculatively — implementation should proceed version by version (see Roadmap), starting with V0 (auth, tenant/membership model, empty shell) before any sales-domain feature.
- When adding a new aggregate (e.g., `Opportunity`), add in this order: Drizzle schema (with `tenant_id` + RLS) → service module → tRPC procedures → (if applicable) AI tool wrapper → UI.
- Keep this file up to date as decisions change — if an open question below gets answered, move it into the relevant section above and remove it from Open Questions.

## 19. Roadmap

- **V0 — Foundation:** repo/infra, auth, tenant + membership model, empty shell UI. Nothing sales-domain yet.
- **V1 — Sales Core:** configurable CRM (leads/opportunities/quotes/pipeline/accounts/contacts/activities/tasks), tenant-configurable pipeline + custom fields, CSV import with AI-assisted column mapping (human-approved).
- **V2 — Guided Setup & Assist:** AI setup wizard proposing pipeline/fields from imported data, the `Suggestion` approval primitive, first deterministic automation rules, AI email/summary drafting.
- **V3 — Operational Agent:** tool-calling agent surfacing at-risk/stale opportunities and drafting recommended actions; durable execution for multi-day approval chains.
- **V4 — Analytics & Forecasting:** stable metrics layer + NL analytics agent over it, pipeline health/forecasting.
- **V5 — Expanded Implementation Agent & Integrations:** deeper "connect existing systems," more autonomous onboarding from arbitrary docs/CRMs, integrations beyond CSV/email, inventory/order completion. This is the full "self-implementing ERP" vision — only attempt once V1–V4 have proven the config model and AI-trust pattern on real customers.

## 20. Open Questions (unresolved — do not assume an answer)

1. Target vertical: stay horizontal SMB, or focus V1–V2 on a specific vertical (e.g., quote-heavy B2B distribution/manufacturing)?
2. Auth provider: build (Auth.js/Lucia) vs. buy (Clerk/WorkOS, which have built-in org/multi-tenant support)? Depends on cost tolerance and self-hosting requirements.
3. Pricing model (seat-based vs. usage-based) — affects whether AI features need metering/gating from V1, since compute cost scales with usage.
4. Data residency/compliance target (e.g., EU/GDPR) — affects hosting region choice; should be decided before infra is provisioned, not retrofitted.
5. Appetite for design partners/early customers to validate the "AI proposes configuration" assumption before over-investing in that flow.
6. Team size/solo — affects how aggressively the roadmap should be sequenced vs. parallelized.

## 21. Future Architectural Considerations (not decided, revisit later)

- Splitting into a monorepo if a second consumer (mobile app, public API) needs the same business services.
- Schema-per-tenant or DB-per-tenant if a specific enterprise customer contractually requires physical data isolation.
- A dedicated vector database if pgvector's performance/scale becomes limiting.
- LangGraph.js (or similar) once an agent genuinely needs branching, resumable, multi-step state (expected no earlier than V3).
- A more general workflow definition language only if the flat trigger/condition/action model provably can't express a rule real customers need (branching/loops) — treat this as a high bar, not a default evolution.
