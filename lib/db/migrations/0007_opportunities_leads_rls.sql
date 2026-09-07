ALTER TABLE "opportunities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "opportunities" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "opportunities"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));

ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leads" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "leads"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));
