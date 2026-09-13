import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema/tenant";
import { users } from "@/lib/db/schema/user";
import type { ActorContext } from "@/lib/auth/actor";
import type { MembershipRole } from "@/lib/db/schema/membership";
import * as tenantSettingsService from "./tenant-settings";

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
  const [user] = await db
    .insert(users)
    .values({ clerkUserId: `user_${label}_${crypto.randomUUID()}`, email: `${label}@example.com` })
    .returning();
  createdUserIds.push(user.id);
  return { tenantId: tenant.id, userId: user.id, role };
}

describe("tenant settings service", () => {
  it("returns synthesized defaults when no row exists", async () => {
    const actor = await createActor("a");
    const settings = await tenantSettingsService.getSettings(actor.tenantId);
    expect(settings).toMatchObject({
      tenantId: actor.tenantId,
      legalName: null,
      defaultCurrency: "EUR",
      defaultTaxRatePercent: "21.00",
      irpfEnabled: false,
      invoiceNumberFormat: "INV-{YYYY}-{SEQ:4}",
      defaultPaymentTermsDays: 30,
      allowNegativeStock: true,
    });
  });

  it("persists an update and merges partial patches without clobbering other fields", async () => {
    const actor = await createActor("a");

    await tenantSettingsService.updateSettings(actor, {
      legalName: "Acme Distribución SL",
      taxId: "B12345678",
      legalAddress: { line1: "Calle Mayor 1", city: "Madrid", postalCode: "28013", country: "es" },
      defaultTaxRatePercent: 10,
      irpfEnabled: true,
      irpfRatePercent: 7,
    });

    let settings = await tenantSettingsService.getSettings(actor.tenantId);
    expect(settings.legalName).toBe("Acme Distribución SL");
    expect(settings.legalAddress?.country).toBe("ES"); // normalized upper-case
    expect(settings.defaultTaxRatePercent).toBe("10.00");
    expect(settings.irpfRatePercent).toBe("7.00");

    // a second, unrelated patch must not reset legalName or the tax rate
    await tenantSettingsService.updateSettings(actor, { defaultPaymentTermsDays: 60 });
    settings = await tenantSettingsService.getSettings(actor.tenantId);
    expect(settings.legalName).toBe("Acme Distribución SL");
    expect(settings.defaultTaxRatePercent).toBe("10.00");
    expect(settings.defaultPaymentTermsDays).toBe(60);
  });

  it("requires a manager role to update", async () => {
    const actor = await createActor("a", "sales_rep");
    await expect(tenantSettingsService.updateSettings(actor, { legalName: "X" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("does not leak settings across tenants", async () => {
    const a = await createActor("a");
    const b = await createActor("b");
    await tenantSettingsService.updateSettings(a, { legalName: "Tenant A SL" });

    const bSettings = await tenantSettingsService.getSettings(b.tenantId);
    expect(bSettings.legalName).toBeNull();

    // writing B's settings must not touch A's row
    await tenantSettingsService.updateSettings(b, { legalName: "Tenant B SL" });
    expect((await tenantSettingsService.getSettings(a.tenantId)).legalName).toBe("Tenant A SL");
  });
});
