# erp_test — hands-on walkthrough

A guided tour of the app as it exists today: how to run it locally and a ~10-minute
test drive through the sales flow.

## What erp_test is

A multi-tenant sales CRM core — the V1 slice of an "AI-native ERP". It covers the
sales workflow: accounts/contacts, a tenant-configurable pipeline, leads that convert
to opportunities, activities/tasks, products, quotes, and a stub order on close.

The "AI-native" layers (setup wizard, the `Suggestion` approval primitive, automations,
drafting, analytics) are **not built yet** — see roadmap in [`.claude/CLAUDE.md`](../.claude/CLAUDE.md)
§19. The only AI in the product today is a column-mapping *suggestion* on CSV import,
and the import flow works fully without it.

One Clerk **Organization = one tenant**. Everything you create lives inside the org you
sign in with.

## Run it locally

Prerequisites: Node, Docker, and a Clerk account (free dev instance is fine).

```bash
# 1. Start Postgres (also creates the restricted `erp_app` role RLS depends on)
docker compose up -d

# 2. Configure env — copy the template and fill in the Clerk keys
cp .env.example .env.local
```

`.env.local` values (the DB URLs match the docker-compose setup as-is):

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | `postgresql://erp_app:erp_app@localhost:5432/erp_test` (app connects as the restricted role — this is what makes row-level security apply) |
| `MIGRATIONS_DATABASE_URL` | `postgresql://erp_test:erp_test@localhost:5432/erp_test` (migrations run as the table owner) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | from your Clerk dashboard |
| `CLERK_SECRET_KEY` | from your Clerk dashboard |
| `OPENAI_API_KEY` | optional — only pre-fills the CSV mapping screen; leave blank to map manually |

In the **Clerk dashboard**, enable **Organizations** (Configure → Organizations). The app
routes every signed-in user without an active org to an org-creation screen.

```bash
# 3. Install, migrate, run
npm install
npm run db:migrate
npm run dev
```

Open http://localhost:3000.

## The 10-minute test drive

### 1. Sign up and create an organization

Sign up from the landing page. On first load of `/dashboard` you'll be asked to
**create or select an organization** — create one. That org is your tenant, and creating
it seeds a default pipeline: **Qualification → Proposal → Negotiation → Won → Lost**.

As the org creator you're an **admin**. (Anyone you later invite comes in as `sales_rep`
and won't see the Settings section — there's no UI to assign the `sales_manager` role yet.)

The dashboard now shows your role and an empty pipeline summary.

### 2. (Optional) Configure the pipeline and custom fields

`Settings → Pipeline`: rename a stage inline (edit the text, hit **Save**), reorder with
the ↑/↓ buttons, add a stage, or remove one. The grey badge on each row is its *kind*
(`open` / `won` / `lost`) — that's what drives behaviour later, not the name.

`Settings → Custom fields`: tabs for **Accounts** and **Opportunities** only. Add a field
(text / number / date / select / boolean; a `select` needs comma-separated options; tick
**Required** to enforce it). These appear as a form on the matching detail pages.

### 3. Create an account and a contact

`Accounts` → the quick form takes a **name only**. Create one, then click it to open the
detail page. There you can add **contacts** (first + last name) and fill any account
custom fields you defined.

### 4. Add products

`Products` → create with **name + unit price**. Add two or three — quotes pull from this
catalog. Editing a product's price later does **not** change totals on existing quotes
(the price is snapshotted when a line item is added).

### 5. (Optional) Bulk import instead of hand entry

`Import` → choose **Accounts** or **Leads**, upload a CSV. You get a mapping table
(column → field). With an `OPENAI_API_KEY` set, the mapping is pre-filled; without one you
map it yourself. For Accounts you can also send a column to a **new custom field**. Hit
**Import N rows** and you'll get a success/failure summary.

### 6. Create a lead and convert it

`Leads` → the quick form takes **first + last name only** (there's no lead detail page —
leads are deliberately thin). Create one, then click **Convert to Opportunity**. That
creates an opportunity in your first `open` stage and marks the lead *Converted*.

**Undo conversion** is available only while the opportunity has no activity, task, or
quote attached — once it has real work, you delete the opportunity directly instead.

### 7. Work the opportunity

`Opportunities` is a kanban board grouped by pipeline stage. Click your opportunity to
open its detail page, where you can:

- **Deal value** — type a number, **Save**. This feeds the dashboard's pipeline value.
- **Activities** — add a note; it's appended (activities are append-only, no delete).
- **Tasks** — add a title, tick the checkbox to complete it.
- **Custom fields** — any opportunity fields you defined.
- **Quotes** — click **Create quote**.

### 8. Build a quote

Open the quote (link under *Quotes* on the opportunity, or from the `Quotes` index).
Pick a **product** and **quantity**, **Add line item**. The unit price is copied from the
catalog; the **Total** updates deterministically. Adjust a quantity inline and **Save**,
or **Remove** a line. `Quotes` in the sidebar lists every quote with search + pagination.

### 9. Close the deal

Back on the board (or the opportunity card's **Move to stage** dropdown), move the
opportunity into your **Won**-kind stage. A green **Order created** banner appears on the
opportunity detail page — follow it to `/orders/[id]`, a stub order showing the linked
opportunity, deal value, and quotes. Moving to won again does nothing (the order is
created exactly once).

Moving into the **Lost**-kind stage just relocates the card — no order, no prompt.

### 10. Read the dashboard

`Dashboard` now shows **open pipeline value**, **won value**, **lost deal count**, and a
per-stage breakdown of counts and value.

## Things a tester will notice are missing (on purpose, for now)

- No lead detail page; leads only carry a name in the UI.
- Custom fields exist for accounts and opportunities only.
- Won/Lost is the stage dropdown — there's no dedicated close button or "lost reason".
- Orders are a stub (no line items of their own, no fulfillment).
- No AI beyond CSV mapping; no automations, approvals, email drafting, or analytics.

See [`.claude/CLAUDE.md`](../.claude/CLAUDE.md) §6 and §19 for what's scoped where.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `permission denied for table ...` / queries return nothing | `DATABASE_URL` is pointing at the `erp_test` superuser instead of `erp_app` — superusers bypass RLS and some grants differ. Use the `erp_app` URL from the table above. |
| Stuck on "Create or select an organization" after creating one | Organizations aren't enabled in the Clerk dashboard, or the dev keys in `.env.local` are for a different Clerk instance. |
| `MIGRATIONS_DATABASE_URL is not set` when running `npm run db:migrate` | `drizzle-kit` isn't picking up `.env.local`. Confirm the file is at the repo root, or run with the var exported / via `dotenv-cli` (`npx dotenv -e .env.local -- npm run db:migrate`). |
| Dashboard is empty | Expected until at least one opportunity exists — convert a lead first. |
| CSV import: "AI suggestion unavailable" | No `OPENAI_API_KEY`. Harmless — map the columns manually. |
