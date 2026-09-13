ALTER TABLE "tenant_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_settings" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "tenant_settings"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));

ALTER TABLE "sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sequences" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "sequences"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));

ALTER TABLE "audit_log_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log_entries" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "audit_log_entries"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));

ALTER TABLE "warehouses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "warehouses" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "warehouses"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));
