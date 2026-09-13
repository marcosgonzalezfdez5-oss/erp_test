ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "invoices"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));

ALTER TABLE "invoice_line_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_line_items" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "invoice_line_items"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));

ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "payments"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));

ALTER TABLE "payment_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_allocations" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "payment_allocations"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));
