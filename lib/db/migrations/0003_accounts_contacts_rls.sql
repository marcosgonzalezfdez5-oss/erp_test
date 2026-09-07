-- Tenant isolation for tenant-owned tables (see CLAUDE.md §7). FORCE is
-- required because the app connects as the table owner, which Postgres
-- otherwise exempts from RLS by default.
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accounts" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "accounts"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));

ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contacts" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "contacts"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));
