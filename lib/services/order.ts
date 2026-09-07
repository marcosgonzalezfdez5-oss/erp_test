import { and, eq } from "drizzle-orm";
import { orders } from "@/lib/db/schema/order";
import { withTenantContext } from "@/lib/db/tenant-context";

export async function getOrderByOpportunity(tenantId: string, opportunityId: string) {
  const [order] = await withTenantContext(tenantId, (tx) =>
    tx
      .select()
      .from(orders)
      .where(and(eq(orders.tenantId, tenantId), eq(orders.opportunityId, opportunityId))),
  );
  return order ?? null;
}
