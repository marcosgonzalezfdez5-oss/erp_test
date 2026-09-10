ALTER TABLE "suggestions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "suggestions" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "suggestions"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));
