import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { ActorContext } from "@/lib/auth/actor";
import { isSystemActor } from "@/lib/auth/actor";
import { requireRole } from "@/lib/auth/authorize";
import { accounts } from "@/lib/db/schema/account";
import { invoices, type Invoice } from "@/lib/db/schema/invoice";
import { paymentAllocations, paymentMethodEnum, payments, type Payment, type PaymentAllocation } from "@/lib/db/schema/payment";
import { withTenantContext, type Tx } from "@/lib/db/tenant-context";
import { fromCents, toCents } from "@/lib/money";
import { recordAudit } from "./audit";
import { recomputeInvoicePaymentStatus } from "./invoice";

const MANAGER_ROLES: ActorContext["role"][] = ["admin", "sales_manager"];
export const PAYMENT_PAGE_SIZE = 20;

const money = z.number().positive().multipleOf(0.01).max(100_000_000);
const allocationInput = z.object({ invoiceId: z.string().uuid(), amount: money });

// ---------------------------------------------------------------------------
// helpers

/** cents already allocated across a payment's allocations. */
async function allocatedCents(tx: Tx, tenantId: string, paymentId: string): Promise<bigint> {
  const [{ total }] = await tx
    .select({ total: sql<string>`coalesce(sum(${paymentAllocations.amount}), 0)` })
    .from(paymentAllocations)
    .where(and(eq(paymentAllocations.tenantId, tenantId), eq(paymentAllocations.paymentId, paymentId)));
  return toCents(total);
}

/** An issued invoice's still-outstanding cents (total − already paid). */
function outstandingCents(invoice: Pick<Invoice, "totalAmount" | "amountPaid">): bigint {
  return toCents(invoice.totalAmount) - toCents(invoice.amountPaid);
}

async function requireAllocatableInvoice(tx: Tx, tenantId: string, accountId: string, invoiceId: string): Promise<Invoice> {
  const [invoice] = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)))
    .for("update");
  if (!invoice) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice not found" });
  if (invoice.accountId !== accountId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Invoice belongs to a different account." });
  }
  if (invoice.documentType !== "invoice") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "A payment can only be applied to an invoice." });
  }
  if (!["issued", "partially_paid", "paid"].includes(invoice.status)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: `A ${invoice.status} invoice can't take a payment.` });
  }
  return invoice;
}

/**
 * Inserts allocation rows for `paymentId`, enforcing (a) the payment isn't
 * over-allocated and (b) no invoice is paid past its outstanding balance, then
 * refreshes each touched invoice's paid amount + status.
 */
async function allocate(
  tx: Tx,
  tenantId: string,
  payment: Payment,
  requested: Array<{ invoiceId: string; amount: number }>,
): Promise<void> {
  const already = await allocatedCents(tx, tenantId, payment.id);
  let running = already;
  const paymentCents = toCents(payment.amount);

  for (const alloc of requested) {
    const invoice = await requireAllocatableInvoice(tx, tenantId, payment.accountId, alloc.invoiceId);
    const amountCents = toCents(alloc.amount.toFixed(2));

    running += amountCents;
    if (running > paymentCents) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Allocations exceed the payment amount." });
    }
    if (amountCents > outstandingCents(invoice)) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `Allocation exceeds the outstanding balance of invoice ${invoice.number ?? invoice.id}.`,
      });
    }

    await tx.insert(paymentAllocations).values({
      tenantId,
      paymentId: payment.id,
      invoiceId: alloc.invoiceId,
      amount: alloc.amount.toFixed(2),
    });
    await recomputeInvoicePaymentStatus(tx, tenantId, alloc.invoiceId);
  }
}

async function requirePayment(tx: Tx, tenantId: string, id: string): Promise<Payment> {
  const [row] = await tx.select().from(payments).where(and(eq(payments.tenantId, tenantId), eq(payments.id, id)));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Payment not found" });
  return row;
}

// ---------------------------------------------------------------------------
// record

export const recordPaymentInput = z.object({
  accountId: z.string().uuid(),
  amount: money,
  method: z.enum(paymentMethodEnum.enumValues).default("bank_transfer"),
  reference: z.string().trim().max(200).optional(),
  receivedDate: z.coerce.date().optional(),
  note: z.string().trim().max(2000).optional(),
  allocations: z.array(allocationInput).default([]),
});

export async function recordPayment(
  actor: ActorContext,
  rawInput: z.input<typeof recordPaymentInput>,
): Promise<{ payment: Payment; allocations: PaymentAllocation[] }> {
  const input = recordPaymentInput.parse(rawInput);
  const { tenantId } = actor;
  return withTenantContext(tenantId, async (tx) => {
    const [account] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), eq(accounts.id, input.accountId), isNull(accounts.deletedAt)));
    if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });

    const [payment] = await tx
      .insert(payments)
      .values({
        tenantId,
        accountId: input.accountId,
        amount: input.amount.toFixed(2),
        method: input.method,
        reference: input.reference ?? null,
        receivedDate: input.receivedDate ?? new Date(),
        note: input.note ?? null,
        createdByUserId: isSystemActor(actor) ? null : actor.userId,
      })
      .returning();

    await allocate(tx, tenantId, payment, input.allocations);

    await recordAudit(tx, tenantId, actor, {
      entityType: "payment",
      entityId: payment.id,
      action: "payment.record",
      summary: `Recorded ${payment.amount} ${input.method} payment`,
    });

    const allocations = await tx
      .select()
      .from(paymentAllocations)
      .where(and(eq(paymentAllocations.tenantId, tenantId), eq(paymentAllocations.paymentId, payment.id)));
    return { payment, allocations };
  });
}

export const allocatePaymentInput = z.object({
  paymentId: z.string().uuid(),
  allocations: z.array(allocationInput).min(1),
});

export async function allocatePayment(
  actor: ActorContext,
  rawInput: z.input<typeof allocatePaymentInput>,
): Promise<PaymentAllocation[]> {
  const input = allocatePaymentInput.parse(rawInput);
  const { tenantId } = actor;
  return withTenantContext(tenantId, async (tx) => {
    const payment = await requirePayment(tx, tenantId, input.paymentId);
    await allocate(tx, tenantId, payment, input.allocations);
    return tx
      .select()
      .from(paymentAllocations)
      .where(and(eq(paymentAllocations.tenantId, tenantId), eq(paymentAllocations.paymentId, payment.id)));
  });
}

export async function deallocate(actor: ActorContext, allocationId: string): Promise<void> {
  const { tenantId } = actor;
  await withTenantContext(tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(paymentAllocations)
      .where(and(eq(paymentAllocations.tenantId, tenantId), eq(paymentAllocations.id, allocationId)));
    if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Allocation not found" });
    await tx.delete(paymentAllocations).where(and(eq(paymentAllocations.tenantId, tenantId), eq(paymentAllocations.id, allocationId)));
    await recomputeInvoicePaymentStatus(tx, tenantId, existing.invoiceId);
  });
}

export async function deletePayment(actor: ActorContext, id: string): Promise<void> {
  requireRole(actor.role, MANAGER_ROLES);
  const { tenantId } = actor;
  await withTenantContext(tenantId, async (tx) => {
    const payment = await requirePayment(tx, tenantId, id);
    const affected = await tx
      .select({ invoiceId: paymentAllocations.invoiceId })
      .from(paymentAllocations)
      .where(and(eq(paymentAllocations.tenantId, tenantId), eq(paymentAllocations.paymentId, id)));

    await tx.delete(payments).where(and(eq(payments.tenantId, tenantId), eq(payments.id, id)));
    for (const { invoiceId } of affected) await recomputeInvoicePaymentStatus(tx, tenantId, invoiceId);

    await recordAudit(tx, tenantId, actor, {
      entityType: "payment",
      entityId: payment.id,
      action: "payment.delete",
      summary: `Deleted ${payment.amount} payment`,
    });
  });
}

// ---------------------------------------------------------------------------
// reads

/**
 * What the account still owes: outstanding on issued invoices, less issued
 * credit notes, less any payment amount not yet allocated (held as credit).
 * Positive = customer owes us; negative = we owe the customer.
 */
export async function getAccountBalance(tenantId: string, accountId: string) {
  return withTenantContext(tenantId, async (tx) => {
    const invoiceRows = await tx
      .select({
        documentType: invoices.documentType,
        totalAmount: invoices.totalAmount,
        amountPaid: invoices.amountPaid,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          eq(invoices.accountId, accountId),
          inArray(invoices.status, ["issued", "partially_paid", "paid"]),
        ),
      );

    let outstandingCentsTotal = 0n;
    let creditNoteCentsTotal = 0n;
    for (const row of invoiceRows) {
      if (row.documentType === "credit_note") {
        creditNoteCentsTotal += toCents(row.totalAmount);
      } else {
        outstandingCentsTotal += toCents(row.totalAmount) - toCents(row.amountPaid);
      }
    }

    const [{ paid, allocated }] = await tx
      .select({
        paid: sql<string>`coalesce(sum(${payments.amount}), 0)`,
        allocated: sql<string>`coalesce((
          select sum(${paymentAllocations.amount}) from ${paymentAllocations}
          where ${paymentAllocations.tenantId} = ${tenantId}
            and ${paymentAllocations.paymentId} in (
              select id from ${payments} where ${payments.tenantId} = ${tenantId} and ${payments.accountId} = ${accountId}
            )
        ), 0)`,
      })
      .from(payments)
      .where(and(eq(payments.tenantId, tenantId), eq(payments.accountId, accountId)));

    const unappliedCents = toCents(paid) - toCents(allocated);
    const balanceCents = outstandingCentsTotal - creditNoteCentsTotal - unappliedCents;

    return {
      outstanding: fromCents(outstandingCentsTotal),
      creditNotes: fromCents(creditNoteCentsTotal),
      unappliedCredit: fromCents(unappliedCents < 0n ? 0n : unappliedCents),
      balance: fromCents(balanceCents),
    };
  });
}

export const listPaymentsInput = z.object({ accountId: z.string().uuid().optional() }).optional();

export function listPayments(tenantId: string, rawInput?: z.input<typeof listPaymentsInput>) {
  const input = listPaymentsInput.parse(rawInput);
  return withTenantContext(tenantId, (tx) =>
    tx
      .select({
        id: payments.id,
        accountId: payments.accountId,
        accountName: accounts.name,
        amount: payments.amount,
        method: payments.method,
        reference: payments.reference,
        receivedDate: payments.receivedDate,
        allocatedAmount: sql<string>`coalesce((
          select sum(${paymentAllocations.amount}) from ${paymentAllocations}
          where ${paymentAllocations.paymentId} = ${payments.id}
        ), 0)`,
        createdAt: payments.createdAt,
      })
      .from(payments)
      .leftJoin(accounts, eq(payments.accountId, accounts.id))
      .where(
        and(
          eq(payments.tenantId, tenantId),
          input?.accountId ? eq(payments.accountId, input.accountId) : undefined,
        ),
      )
      .orderBy(desc(payments.receivedDate))
      .limit(PAYMENT_PAGE_SIZE),
  );
}
