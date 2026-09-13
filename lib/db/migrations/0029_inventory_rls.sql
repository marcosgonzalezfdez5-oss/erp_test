ALTER TABLE "stock_levels" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_levels" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "stock_levels"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));

ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_movements" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "stock_movements"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));
