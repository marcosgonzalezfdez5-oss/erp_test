ALTER TABLE "custom_field_definitions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custom_field_definitions" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "custom_field_definitions"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));

ALTER TABLE "custom_field_values" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "custom_field_values" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "custom_field_values"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));
