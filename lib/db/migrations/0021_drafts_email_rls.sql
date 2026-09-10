ALTER TABLE "drafts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "drafts" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "drafts"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));

ALTER TABLE "email_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_messages" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "email_messages"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));
