ALTER TABLE "ai_tool_invocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_tool_invocations" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "ai_tool_invocations"
  USING ("tenant_id"::text = current_setting('app.tenant_id', true));
