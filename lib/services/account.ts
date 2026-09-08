import { TRPCError } from "@trpc/server";
import { and, count, eq, ilike, isNull } from "drizzle-orm";
import { z } from "zod";
import { accounts } from "@/lib/db/schema/account";
import { withTenantContext } from "@/lib/db/tenant-context";

export const PAGE_SIZE = 20;

export const createAccountInput = z.object({
  name: z.string().trim().min(1).max(200),
});

export const updateAccountInput = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
});

export const listAccountsInput = z.object({
  page: z.number().int().min(1).default(1),
  search: z.string().trim().max(200).default(""),
});

export async function listAccounts(
  tenantId: string,
  input: z.infer<typeof listAccountsInput> = listAccountsInput.parse({}),
) {
  return withTenantContext(tenantId, async (tx) => {
    const conditions = [eq(accounts.tenantId, tenantId), isNull(accounts.deletedAt)];
    if (input.search) {
      conditions.push(ilike(accounts.name, `%${input.search}%`));
    }
    const where = and(...conditions);

    const [items, [{ total }]] = await Promise.all([
      tx
        .select()
        .from(accounts)
        .where(where)
        .orderBy(accounts.name)
        .limit(PAGE_SIZE)
        .offset((input.page - 1) * PAGE_SIZE),
      tx.select({ total: count() }).from(accounts).where(where),
    ]);

    return { items, total };
  });
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
