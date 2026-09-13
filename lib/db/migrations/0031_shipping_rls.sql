ALTER TABLE "shipments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shipments" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "shipments"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));

ALTER TABLE "shipment_line_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shipment_line_items" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "shipment_line_items"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));
