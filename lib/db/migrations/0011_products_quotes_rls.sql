ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "products"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));

ALTER TABLE "quotes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quotes" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "quotes"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));

ALTER TABLE "quote_line_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "quote_line_items" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "quote_line_items"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));
