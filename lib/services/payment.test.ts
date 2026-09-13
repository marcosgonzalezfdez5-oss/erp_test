import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema/tenant";
import { users } from "@/lib/db/schema/user";
import type { ActorContext } from "@/lib/auth/actor";
import type { MembershipRole } from "@/lib/db/schema/membership";
import * as accountService from "./account";
import * as pipelineService from "./pipeline";
import * as productService from "./product";
import * as warehouseService from "./warehouse";
import * as tenantSettingsService from "./tenant-settings";
import * as orderService from "./order";
import * as invoiceService from "./invoice";
import * as paymentService from "./payment";

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

afterEach(async () => {
  for (const tenantId of createdTenantIds.splice(0)) {
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  }
  for (const userId of createdUserIds.splice(0)) {
    await db.delete(users).where(eq(users.id, userId));
  }
});

async function createActor(label: string, role: MembershipRole = "admin"): Promise<ActorContext> {
  const [tenant] = await db
    .insert(tenants)
    .values({ clerkOrgId: `org_${label}_${crypto.randomUUID()}`, name: `Tenant ${label}` })
    .returning();
  createdTenantIds.push(tenant.id);
  await pipelineService.seedDefaultPipeline(tenant.id);
  const [user] = await db
    .insert(users)
    .values({ clerkUserId: `user_${label}_${crypto.randomUUID()}`, email: `${label}@example.com` })
    .returning();
  createdUserIds.push(user.id);
  return { tenantId: tenant.id, userId: user.id, role };
}

/** A tenant with one account and one issued invoice for `total` (tax-free). */
async function withIssuedInvoice(label: string, total: number) {
  const actor = await createActor(label);
  const account = await accountService.createAccount(actor.tenantId, { name: "Acme SL" });
  const warehouse = await warehouseService.createWarehouse(actor, { name: "Madrid", code: "MAD" });
  await tenantSettingsService.updateSettings(actor, { legalName: "Vendor SA", taxId: "B12345678" });
  const product = await productService.createProduct(actor.tenantId, {
    name: "Widget",
    unitPrice: total,
    taxRatePercent: 0,
    tracksInventory: false,
  });
  const order = await orderService.createOrder(actor.tenantId, {
    accountId: account.id,
    lines: [{ productId: product.id, quantity: 1 }],
  });
  await orderService.confirmOrder(actor, { id: order.id, warehouseId: warehouse.id });
  const draft = await invoiceService.createInvoiceFromOrder(actor, { orderId: order.id });
  const invoice = await invoiceService.issueInvoice(actor, { id: draft.id });
  return { actor, account, invoice };
}

describe("payment — recording and allocation", () => {
  it("applies an allocation and moves the invoice to paid", async () => {
    const { actor, account, invoice } = await withIssuedInvoice("a", 100);

    await paymentService.recordPayment(actor, {
      accountId: account.id,
      amount: 100,
      allocations: [{ invoiceId: invoice.id, amount: 100 }],
    });

    const refreshed = await invoiceService.getInvoice(actor.tenantId, invoice.id);
    expect(refreshed.amountPaid).toBe("100.00");
    expect(refreshed.status).toBe("paid");
  });

  it("moves a part-allocated invoice to partially_paid", async () => {
    const { actor, account, invoice } = await withIssuedInvoice("a", 100);

    await paymentService.recordPayment(actor, {
      accountId: account.id,
      amount: 40,
      allocations: [{ invoiceId: invoice.id, amount: 40 }],
    });

    const refreshed = await invoiceService.getInvoice(actor.tenantId, invoice.id);
    expect(refreshed.status).toBe("partially_paid");
    expect(refreshed.amountPaid).toBe("40.00");
  });

  it("rejects allocating more than the payment amount", async () => {
    const { actor, account, invoice } = await withIssuedInvoice("a", 100);
    await expect(
      paymentService.recordPayment(actor, {
        accountId: account.id,
        amount: 50,
        allocations: [{ invoiceId: invoice.id, amount: 60 }],
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("rejects allocating past an invoice's outstanding balance", async () => {
    const { actor, account, invoice } = await withIssuedInvoice("a", 100);
    await expect(
      paymentService.recordPayment(actor, {
        accountId: account.id,
        amount: 200,
        allocations: [{ invoiceId: invoice.id, amount: 150 }],
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("payment — account balance", () => {
  it("holds an unallocated remainder as account credit", async () => {
    const { actor, account, invoice } = await withIssuedInvoice("a", 100);

    await paymentService.recordPayment(actor, {
      accountId: account.id,
      amount: 150,
      allocations: [{ invoiceId: invoice.id, amount: 100 }],
    });

    const balance = await paymentService.getAccountBalance(actor.tenantId, account.id);
    expect(balance).toMatchObject({ outstanding: "0.00", unappliedCredit: "50.00", balance: "-50.00" });
  });

  it("nets an issued credit note off the balance", async () => {
    const { actor, account, invoice } = await withIssuedInvoice("a", 100);
    await invoiceService.rectifyInvoice(actor, { id: invoice.id, reason: "R1" });

    const balance = await paymentService.getAccountBalance(actor.tenantId, account.id);
    // 100 outstanding − 100 credit note − 0 unapplied
    expect(balance.balance).toBe("0.00");
  });
});

describe("payment — deletion", () => {
  it("recomputes the invoice and is manager-gated", async () => {
    const { actor, account, invoice } = await withIssuedInvoice("a", 100);
    const { payment } = await paymentService.recordPayment(actor, {
      accountId: account.id,
      amount: 100,
      allocations: [{ invoiceId: invoice.id, amount: 100 }],
    });

    await expect(
      paymentService.deletePayment({ ...actor, role: "sales_rep" }, payment.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await paymentService.deletePayment(actor, payment.id);
    const refreshed = await invoiceService.getInvoice(actor.tenantId, invoice.id);
    expect(refreshed.status).toBe("issued");
    expect(refreshed.amountPaid).toBe("0.00");
  });
});

describe("payment — tenant isolation", () => {
  it("cannot pay or delete across tenants", async () => {
    const { actor: a, account: accountA, invoice } = await withIssuedInvoice("a", 100);
    const { actor: b } = await withIssuedInvoice("b", 100);

    await expect(
      paymentService.recordPayment(b, {
        accountId: accountA.id,
        amount: 100,
        allocations: [{ invoiceId: invoice.id, amount: 100 }],
      }),
    ).rejects.toThrow(TRPCError);

    const { payment } = await paymentService.recordPayment(a, {
      accountId: accountA.id,
      amount: 100,
      allocations: [{ invoiceId: invoice.id, amount: 100 }],
    });
    await expect(paymentService.deletePayment(b, payment.id)).rejects.toThrow(TRPCError);
    expect(await paymentService.listPayments(b.tenantId)).toHaveLength(0); // a's payment is invisible to b
  });
});
