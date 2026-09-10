ALTER TABLE "automation_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "automation_rules" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "automation_rules"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));

ALTER TABLE "automation_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "automation_runs" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "automation_runs"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));
