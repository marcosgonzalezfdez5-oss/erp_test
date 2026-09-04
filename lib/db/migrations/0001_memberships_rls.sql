-- Tenant isolation for a tenant-owned table (see CLAUDE.md §7). FORCE is
-- required because the app connects as the table owner, which Postgres
-- otherwise exempts from RLS by default.
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "memberships"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));
