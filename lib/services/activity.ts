import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { activities, activityTypeEnum } from "@/lib/db/schema/activity";
import { withTenantContext } from "@/lib/db/tenant-context";
import { getOpportunity } from "./opportunity";

export const createActivityInput = z.object({
  opportunityId: z.string().uuid(),
  type: z.enum(activityTypeEnum.enumValues),
  note: z.string().trim().min(1).max(2000),
});

export function listActivitiesByOpportunity(tenantId: string, opportunityId: string) {
  return withTenantContext(tenantId, (tx) =>
    tx
      .select()
      .from(activities)
      .where(and(eq(activities.tenantId, tenantId), eq(activities.opportunityId, opportunityId)))
      .orderBy(asc(activities.createdAt)),
  );
}

export async function createActivity(tenantId: string, input: z.infer<typeof createActivityInput>) {
  await getOpportunity(tenantId, input.opportunityId); // confirms it exists in this tenant

  const [activity] = await withTenantContext(tenantId, (tx) =>
    tx
      .insert(activities)
      .values({ tenantId, opportunityId: input.opportunityId, type: input.type, note: input.note })
      .returning(),
  );
  return activity;
}
