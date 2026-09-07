import { TRPCError } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { tasks } from "@/lib/db/schema/task";
import { withTenantContext } from "@/lib/db/tenant-context";
import { getOpportunity } from "./opportunity";

export const createTaskInput = z.object({
  opportunityId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  dueDate: z.coerce.date().optional(),
});

export function listTasksByOpportunity(tenantId: string, opportunityId: string) {
  return withTenantContext(tenantId, (tx) =>
    tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.tenantId, tenantId), eq(tasks.opportunityId, opportunityId)))
      .orderBy(asc(tasks.createdAt)),
  );
}

export async function createTask(tenantId: string, input: z.infer<typeof createTaskInput>) {
  await getOpportunity(tenantId, input.opportunityId); // confirms it exists in this tenant

  const [task] = await withTenantContext(tenantId, (tx) =>
    tx
      .insert(tasks)
      .values({ tenantId, opportunityId: input.opportunityId, title: input.title, dueDate: input.dueDate })
      .returning(),
  );
  return task;
}

export const setTaskCompletionInput = z.object({
  id: z.string().uuid(),
  completed: z.boolean(),
});

export async function setTaskCompletion(tenantId: string, input: z.infer<typeof setTaskCompletionInput>) {
  const [task] = await withTenantContext(tenantId, (tx) =>
    tx
      .update(tasks)
      .set({ completedAt: input.completed ? new Date() : null })
      .where(and(eq(tasks.tenantId, tenantId), eq(tasks.id, input.id)))
      .returning(),
  );
  if (!task) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
  }
  return task;
}
