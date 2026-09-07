ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "orders"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));
