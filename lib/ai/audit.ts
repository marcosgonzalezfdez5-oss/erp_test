import { aiToolInvocations } from "@/lib/db/schema/ai-tool-invocation";
import { withTenantContext } from "@/lib/db/tenant-context";

export function logAiToolInvocation(
  tenantId: string,
  userId: string,
  toolName: string,
  args: unknown,
  result: unknown,
) {
  return withTenantContext(tenantId, (tx) =>
    tx.insert(aiToolInvocations).values({ tenantId, userId, toolName, arguments: args, result }),
  );
}
