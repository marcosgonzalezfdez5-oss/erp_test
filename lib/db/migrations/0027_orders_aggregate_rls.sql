ALTER TABLE "order_line_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_line_items" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "order_line_items"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));
