import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { contacts } from "@/lib/db/schema/contact";
import { withTenantContext } from "@/lib/db/tenant-context";
import { getAccount } from "./account";

export const createContactInput = z.object({
  accountId: z.string().uuid(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().min(1).max(50).optional(),
});

export const updateContactInput = z.object({
  id: z.string().uuid(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().min(1).max(50).optional(),
});

export function listContactsByAccount(tenantId: string, accountId: string) {
  return withTenantContext(tenantId, (tx) =>
    tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.accountId, accountId), isNull(contacts.deletedAt)))
      .orderBy(contacts.lastName, contacts.firstName),
  );
}

export async function getContact(tenantId: string, id: string) {
  const [contact] = await withTenantContext(tenantId, (tx) =>
    tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, id), isNull(contacts.deletedAt))),
  );
  if (!contact) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Contact not found" });
  }
  return contact;
}

export async function createContact(tenantId: string, input: z.infer<typeof createContactInput>) {
  // Confirms the account exists in this tenant before attaching a contact to it.
  await getAccount(tenantId, input.accountId);

  const [contact] = await withTenantContext(tenantId, (tx) =>
    tx
      .insert(contacts)
      .values({
        tenantId,
        accountId: input.accountId,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
      })
      .returning(),
  );
  return contact;
}

export async function updateContact(tenantId: string, input: z.infer<typeof updateContactInput>) {
  const [contact] = await withTenantContext(tenantId, (tx) =>
    tx
      .update(contacts)
      .set({
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        updatedAt: new Date(),
      })
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, input.id), isNull(contacts.deletedAt)))
      .returning(),
  );
  if (!contact) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Contact not found" });
  }
  return contact;
}

export async function deleteContact(tenantId: string, id: string) {
  const [contact] = await withTenantContext(tenantId, (tx) =>
    tx
      .update(contacts)
      .set({ deletedAt: new Date() })
      .where(and(eq(contacts.tenantId, tenantId), eq(contacts.id, id), isNull(contacts.deletedAt)))
      .returning(),
  );
  if (!contact) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Contact not found" });
  }
  return contact;
}
