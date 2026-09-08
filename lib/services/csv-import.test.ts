import { afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tenants } from "@/lib/db/schema/tenant";
import { users } from "@/lib/db/schema/user";
import * as accountService from "./account";
import * as leadService from "./lead";
import * as customFieldService from "./custom-field";
import { NEW_CUSTOM_FIELD_TARGET, analyzeCsv, runImport } from "./csv-import";

vi.mock("ai", () => ({ generateObject: vi.fn() }));
import { generateObject } from "ai";

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

async function createTenant(label: string) {
  const [tenant] = await db
    .insert(tenants)
    .values({ clerkOrgId: `org_${label}_${crypto.randomUUID()}`, name: `Tenant ${label}` })
    .returning();
  createdTenantIds.push(tenant.id);
  return tenant;
}

async function createUser(label: string) {
  const [user] = await db
    .insert(users)
    .values({ clerkUserId: `user_${label}_${crypto.randomUUID()}`, email: `${label}@example.com` })
    .returning();
  createdUserIds.push(user.id);
  return user;
}

describe("csv import — accounts", () => {
  it("imports rows and creates a new custom field for an unmapped column", async () => {
    const tenant = await createTenant("a");
    const csvText = "Company,Industry\nAcme Corp,Manufacturing\nGlobex,Tech";

    const result = await runImport(tenant.id, {
      entityType: "account",
      csvText,
      mapping: [
        { column: "Company", target: "name" },
        { column: "Industry", target: NEW_CUSTOM_FIELD_TARGET },
      ],
    });

    expect(result.imported).toBe(2);
    expect(result.failed).toHaveLength(0);

    const accounts = await accountService.listAccounts(tenant.id);
    expect(accounts.items.map((a) => a.name).sort()).toEqual(["Acme Corp", "Globex"]);

    const definitions = await customFieldService.listDefinitions(tenant.id, "account");
    expect(definitions).toHaveLength(1);
    expect(definitions[0].name).toBe("Industry");

    const acme = accounts.items.find((a) => a.name === "Acme Corp")!;
    const values = await customFieldService.listValuesForEntity(tenant.id, "account", acme.id);
    expect(values[0].value).toBe("Manufacturing");
  });

  it("skips fully blank lines within the CSV", async () => {
    const tenant = await createTenant("a");
    const csvText = "Company\nAcme Corp\n\nGlobex";

    const result = await runImport(tenant.id, {
      entityType: "account",
      csvText,
      mapping: [{ column: "Company", target: "name" }],
    });

    expect(result.imported).toBe(2);
    expect(result.failed).toHaveLength(0);
  });

  it("fails a row with no value for a required field, not the whole import", async () => {
    const tenant = await createTenant("a");
    const csvText = "Company,Notes\nAcme Corp,ok\n,missing name";

    const result = await runImport(tenant.id, {
      entityType: "account",
      csvText,
      mapping: [{ column: "Company", target: "name" }],
    });

    expect(result.imported).toBe(1);
    expect(result.failed).toEqual([{ row: 2, error: 'Missing required field "name"' }]);
  });

  it("does not create records in another tenant", async () => {
    const tenantA = await createTenant("a");
    const tenantB = await createTenant("b");

    await runImport(tenantA.id, {
      entityType: "account",
      csvText: "Company\nAcme Corp",
      mapping: [{ column: "Company", target: "name" }],
    });

    expect((await accountService.listAccounts(tenantB.id)).items).toHaveLength(0);
  });
});

describe("csv import — leads", () => {
  it("imports leads mapped to native fields", async () => {
    const tenant = await createTenant("a");
    const csvText = "First,Last,Email\nJane,Doe,jane@example.com\nJohn,Smith,";

    const result = await runImport(tenant.id, {
      entityType: "lead",
      csvText,
      mapping: [
        { column: "First", target: "firstName" },
        { column: "Last", target: "lastName" },
        { column: "Email", target: "email" },
      ],
    });

    expect(result.imported).toBe(2);
    const leads = await leadService.listLeads(tenant.id);
    const jane = leads.items.find((l) => l.firstName === "Jane")!;
    expect(jane.lastName).toBe("Doe");
    expect(jane.email).toBe("jane@example.com");
    const john = leads.items.find((l) => l.firstName === "John")!;
    expect(john.email).toBeNull();
  });

  it("fails rows missing firstName/lastName", async () => {
    const tenant = await createTenant("a");
    const csvText = "First,Last\nJane,\n,Smith";

    const result = await runImport(tenant.id, {
      entityType: "lead",
      csvText,
      mapping: [
        { column: "First", target: "firstName" },
        { column: "Last", target: "lastName" },
      ],
    });

    expect(result.imported).toBe(0);
    expect(result.failed).toHaveLength(2);
  });

  it("ignores a new-custom-field marker for leads (not supported for this entity type)", async () => {
    const tenant = await createTenant("a");
    const csvText = "First,Last,Notes\nJane,Doe,some notes";

    const result = await runImport(tenant.id, {
      entityType: "lead",
      csvText,
      mapping: [
        { column: "First", target: "firstName" },
        { column: "Last", target: "lastName" },
        { column: "Notes", target: NEW_CUSTOM_FIELD_TARGET },
      ],
    });

    expect(result.imported).toBe(1);
    expect(await customFieldService.listDefinitions(tenant.id, "account")).toHaveLength(0);
  });
});

describe("csv import — analyze", () => {
  it("returns headers, row count, and the AI's suggested mapping", async () => {
    const tenant = await createTenant("a");
    const user = await createUser("a");
    vi.mocked(generateObject).mockResolvedValue({
      object: {
        mappings: [
          { column: "Company", suggestedField: "name", isNewCustomField: false, reason: "match" },
          { column: "Industry", suggestedField: null, isNewCustomField: true, reason: "extra data" },
        ],
      },
    } as never);

    const result = await analyzeCsv(tenant.id, user.id, {
      entityType: "account",
      csvText: "Company,Industry\nAcme Corp,Manufacturing",
    });

    expect(result.headers).toEqual(["Company", "Industry"]);
    expect(result.rowCount).toBe(1);
    expect(result.aiAvailable).toBe(true);
    expect(result.mapping).toEqual([
      { column: "Company", suggestedTarget: "name", reason: "match" },
      { column: "Industry", suggestedTarget: NEW_CUSTOM_FIELD_TARGET, reason: "extra data" },
    ]);
  });

  it("falls back to an empty, manually-editable mapping when the AI call fails", async () => {
    const tenant = await createTenant("a");
    const user = await createUser("a");
    vi.mocked(generateObject).mockRejectedValue(new Error("no API key configured"));

    const result = await analyzeCsv(tenant.id, user.id, {
      entityType: "account",
      csvText: "Company,Industry\nAcme Corp,Manufacturing",
    });

    expect(result.headers).toEqual(["Company", "Industry"]);
    expect(result.rowCount).toBe(1);
    expect(result.aiAvailable).toBe(false);
    expect(result.mapping).toEqual([
      { column: "Company", suggestedTarget: null, reason: "" },
      { column: "Industry", suggestedTarget: null, reason: "" },
    ]);
  });
});
