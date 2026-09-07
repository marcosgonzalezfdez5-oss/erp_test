import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { accounts } from "@/lib/db/schema/account";
import { withTenantContext } from "@/lib/db/tenant-context";

export const createAccountInput = z.object({
  name: z.string().trim().min(1).max(200),
});

export const updateAccountInput = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
});

export function listAccounts(tenantId: string) {
  return withTenantContext(tenantId, (tx) =>
    tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), isNull(accounts.deletedAt)))
      .orderBy(accounts.name),
  );
}

export async function getAccount(tenantId: string, id: string) {
  const [account] = await withTenantContext(tenantId, (tx) =>
    tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), eq(accounts.id, id), isNull(accounts.deletedAt))),
  );
  if (!account) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
  }
  return account;
}

export async function createAccount(tenantId: string, input: z.infer<typeof createAccountInput>) {
  const [account] = await withTenantContext(tenantId, (tx) =>
    tx.insert(accounts).values({ tenantId, name: input.name }).returning(),
  );
  return account;
}

export async function updateAccount(tenantId: string, input: z.infer<typeof updateAccountInput>) {
  const [account] = await withTenantContext(tenantId, (tx) =>
    tx
      .update(accounts)
      .set({ name: input.name, updatedAt: new Date() })
      .where(and(eq(accounts.tenantId, tenantId), eq(accounts.id, input.id), isNull(accounts.deletedAt)))
      .returning(),
  );
  if (!account) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
  }
  return account;
}

export async function deleteAccount(tenantId: string, id: string) {
  const [account] = await withTenantContext(tenantId, (tx) =>
    tx
      .update(accounts)
      .set({ deletedAt: new Date() })
      .where(and(eq(accounts.tenantId, tenantId), eq(accounts.id, id), isNull(accounts.deletedAt)))
      .returning(),
  );
  if (!account) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
  }
  return account;
}
