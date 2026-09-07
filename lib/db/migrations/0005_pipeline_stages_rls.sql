ALTER TABLE "pipeline_stages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipeline_stages" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "pipeline_stages"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));
