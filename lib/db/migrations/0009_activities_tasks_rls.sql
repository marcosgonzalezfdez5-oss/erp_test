ALTER TABLE "activities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activities" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "activities"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));

ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "tasks"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));
