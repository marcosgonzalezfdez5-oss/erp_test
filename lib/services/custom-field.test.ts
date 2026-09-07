import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema/tenant";
import * as accountService from "./account";
import * as pipelineService from "./pipeline";
import * as leadService from "./lead";
import * as customFieldService from "./custom-field";

const createdTenantIds: string[] = [];

afterEach(async () => {
  for (const tenantId of createdTenantIds.splice(0)) {
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  }
});

async function createTenant(label: string) {
  const [tenant] = await db
    .insert(tenants)
    .values({ clerkOrgId: `org_${label}_${crypto.randomUUID()}`, name: `Tenant ${label}` })
    .returning();
  createdTenantIds.push(tenant.id);
  return tenant;
}

async function createTenantWithAccount(label: string) {
  const tenant = await createTenant(label);
  const account = await accountService.createAccount(tenant.id, { name: `${label} Co` });
  return { tenant, account };
}

async function createTenantWithOpportunity(label: string) {
  const tenant = await createTenant(label);
  await pipelineService.seedDefaultPipeline(tenant.id);
  const lead = await leadService.createLead(tenant.id, { firstName: "Jane", lastName: "Doe" });
  const opportunity = await leadService.convertLeadToOpportunity(tenant.id, { leadId: lead.id });
  return { tenant, opportunity };
}

describe("custom field service — definitions", () => {
  it("creates and lists definitions scoped to an entity type", async () => {
    const { tenant } = await createTenantWithAccount("a");

    await customFieldService.createDefinition(tenant.id, {
      entityType: "account",
      name: "Industry",
      fieldType: "text",
      required: false,
    });
    await customFieldService.createDefinition(tenant.id, {
      entityType: "opportunity",
      name: "Renewal likelihood",
      fieldType: "number",
      required: false,
    });

    const accountDefs = await customFieldService.listDefinitions(tenant.id, "account");
    expect(accountDefs.map((d) => d.name)).toEqual(["Industry"]);

    const opportunityDefs = await customFieldService.listDefinitions(tenant.id, "opportunity");
    expect(opportunityDefs.map((d) => d.name)).toEqual(["Renewal likelihood"]);
  });

  it("stores options only for select fields", async () => {
    const { tenant } = await createTenantWithAccount("a");

    const select = await customFieldService.createDefinition(tenant.id, {
      entityType: "account",
      name: "Segment",
      fieldType: "select",
      options: ["SMB", "Enterprise"],
      required: false,
    });
    expect(select.options).toEqual(["SMB", "Enterprise"]);

    const text = await customFieldService.createDefinition(tenant.id, {
      entityType: "account",
      name: "Notes",
      fieldType: "text",
      required: false,
    });
    expect(text.options).toBeNull();
  });

  it("deletes a definition scoped to the tenant", async () => {
    const { tenant } = await createTenantWithAccount("a");
    const other = await createTenant("b");

    const definition = await customFieldService.createDefinition(tenant.id, {
      entityType: "account",
      name: "Industry",
      fieldType: "text",
      required: false,
    });

    await expect(customFieldService.deleteDefinition(other.id, definition.id)).rejects.toThrow(TRPCError);
    await customFieldService.deleteDefinition(tenant.id, definition.id);
    expect(await customFieldService.listDefinitions(tenant.id, "account")).toHaveLength(0);
  });
});

describe("custom field service — values", () => {
  it("round-trips a value for every field type", async () => {
    const { tenant, account } = await createTenantWithAccount("a");

    const text = await customFieldService.createDefinition(tenant.id, {
      entityType: "account",
      name: "Notes",
      fieldType: "text",
      required: false,
    });
    const number = await customFieldService.createDefinition(tenant.id, {
      entityType: "account",
      name: "Employee count",
      fieldType: "number",
      required: false,
    });
    const date = await customFieldService.createDefinition(tenant.id, {
      entityType: "account",
      name: "Renewal date",
      fieldType: "date",
      required: false,
    });
    const boolean = await customFieldService.createDefinition(tenant.id, {
      entityType: "account",
      name: "Is partner",
      fieldType: "boolean",
      required: false,
    });
    const select = await customFieldService.createDefinition(tenant.id, {
      entityType: "account",
      name: "Segment",
      fieldType: "select",
      options: ["SMB", "Enterprise"],
      required: false,
    });

    await customFieldService.setValue(tenant.id, { definitionId: text.id, entityId: account.id, value: "Great fit" });
    await customFieldService.setValue(tenant.id, { definitionId: number.id, entityId: account.id, value: 42.5 });
    await customFieldService.setValue(tenant.id, {
      definitionId: date.id,
      entityId: account.id,
      value: "2026-12-01",
    });
    await customFieldService.setValue(tenant.id, { definitionId: boolean.id, entityId: account.id, value: true });
    await customFieldService.setValue(tenant.id, {
      definitionId: select.id,
      entityId: account.id,
      value: "Enterprise",
    });

    const values = await customFieldService.listValuesForEntity(tenant.id, "account", account.id);
    const byName = Object.fromEntries(values.map((v) => [v.name, v.value]));
    expect(byName["Notes"]).toBe("Great fit");
    expect(byName["Employee count"]).toBe(42.5);
    expect(byName["Renewal date"]).toBe("2026-12-01");
    expect(byName["Is partner"]).toBe(true);
    expect(byName["Segment"]).toBe("Enterprise");
  });

  it("upserts rather than duplicating when a value is set twice", async () => {
    const { tenant, account } = await createTenantWithAccount("a");
    const definition = await customFieldService.createDefinition(tenant.id, {
      entityType: "account",
      name: "Notes",
      fieldType: "text",
      required: false,
    });

    await customFieldService.setValue(tenant.id, { definitionId: definition.id, entityId: account.id, value: "v1" });
    await customFieldService.setValue(tenant.id, { definitionId: definition.id, entityId: account.id, value: "v2" });

    const values = await customFieldService.listValuesForEntity(tenant.id, "account", account.id);
    expect(values).toHaveLength(1);
    expect(values[0].value).toBe("v2");
  });

  it("rejects a value that doesn't match the field's type", async () => {
    const { tenant, account } = await createTenantWithAccount("a");
    const number = await customFieldService.createDefinition(tenant.id, {
      entityType: "account",
      name: "Employee count",
      fieldType: "number",
      required: false,
    });
    const select = await customFieldService.createDefinition(tenant.id, {
      entityType: "account",
      name: "Segment",
      fieldType: "select",
      options: ["SMB", "Enterprise"],
      required: false,
    });

    await expect(
      customFieldService.setValue(tenant.id, { definitionId: number.id, entityId: account.id, value: "not a number" }),
    ).rejects.toThrow(TRPCError);
    await expect(
      customFieldService.setValue(tenant.id, { definitionId: select.id, entityId: account.id, value: "Not an option" }),
    ).rejects.toThrow(TRPCError);
  });

  it("supports opportunity-scoped definitions and values", async () => {
    const { tenant, opportunity } = await createTenantWithOpportunity("a");
    const definition = await customFieldService.createDefinition(tenant.id, {
      entityType: "opportunity",
      name: "Renewal likelihood",
      fieldType: "number",
      required: false,
    });

    await customFieldService.setValue(tenant.id, {
      definitionId: definition.id,
      entityId: opportunity.id,
      value: 80,
    });

    const values = await customFieldService.listValuesForEntity(tenant.id, "opportunity", opportunity.id);
    expect(values[0].value).toBe(80);
  });

  it("rejects setting a value using another tenant's definition or entity", async () => {
    const { tenant: tenantA, account } = await createTenantWithAccount("a");
    const { tenant: tenantB, account: accountB } = await createTenantWithAccount("b");

    const definitionA = await customFieldService.createDefinition(tenantA.id, {
      entityType: "account",
      name: "Notes",
      fieldType: "text",
      required: false,
    });

    // tenant B trying to use tenant A's definition
    await expect(
      customFieldService.setValue(tenantB.id, { definitionId: definitionA.id, entityId: accountB.id, value: "x" }),
    ).rejects.toThrow(TRPCError);

    // tenant A trying to set a value against tenant B's account
    await expect(
      customFieldService.setValue(tenantA.id, { definitionId: definitionA.id, entityId: accountB.id, value: "x" }),
    ).rejects.toThrow(TRPCError);

    const values = await customFieldService.listValuesForEntity(tenantA.id, "account", account.id);
    expect(values[0].value).toBeNull();
  });
});
