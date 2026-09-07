import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  customFieldDefinitions,
  customFieldEntityTypeEnum,
  customFieldTypeEnum,
  customFieldValues,
} from "@/lib/db/schema/custom-field";
import { withTenantContext } from "@/lib/db/tenant-context";
import { getAccount } from "./account";
import { getOpportunity } from "./opportunity";

type EntityType = (typeof customFieldEntityTypeEnum.enumValues)[number];
type FieldType = (typeof customFieldTypeEnum.enumValues)[number];

async function requireEntity(tenantId: string, entityType: EntityType, entityId: string) {
  if (entityType === "account") {
    await getAccount(tenantId, entityId);
  } else {
    await getOpportunity(tenantId, entityId);
  }
}

export const createDefinitionInput = z.discriminatedUnion("fieldType", [
  z.object({
    entityType: z.enum(customFieldEntityTypeEnum.enumValues),
    name: z.string().trim().min(1).max(100),
    fieldType: z.literal("select"),
    options: z.array(z.string().trim().min(1)).min(1),
    required: z.boolean().default(false),
  }),
  z.object({
    entityType: z.enum(customFieldEntityTypeEnum.enumValues),
    name: z.string().trim().min(1).max(100),
    fieldType: z.enum(["text", "number", "date", "boolean"]),
    required: z.boolean().default(false),
  }),
]);

export function listDefinitions(tenantId: string, entityType: EntityType) {
  return withTenantContext(tenantId, (tx) =>
    tx
      .select()
      .from(customFieldDefinitions)
      .where(and(eq(customFieldDefinitions.tenantId, tenantId), eq(customFieldDefinitions.entityType, entityType)))
      .orderBy(customFieldDefinitions.createdAt),
  );
}

export async function createDefinition(tenantId: string, input: z.infer<typeof createDefinitionInput>) {
  const [definition] = await withTenantContext(tenantId, (tx) =>
    tx
      .insert(customFieldDefinitions)
      .values({
        tenantId,
        entityType: input.entityType,
        name: input.name,
        fieldType: input.fieldType,
        options: input.fieldType === "select" ? input.options : null,
        required: input.required,
      })
      .returning(),
  );
  return definition;
}

export async function deleteDefinition(tenantId: string, id: string) {
  const [definition] = await withTenantContext(tenantId, (tx) =>
    tx
      .delete(customFieldDefinitions)
      .where(and(eq(customFieldDefinitions.tenantId, tenantId), eq(customFieldDefinitions.id, id)))
      .returning(),
  );
  if (!definition) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Custom field definition not found" });
  }
  return definition;
}

// value is genuinely dynamic (its shape depends on the definition's
// fieldType, which is only known at request time) — validated at runtime
// below rather than by the static Zod input schema. See CLAUDE.md §11.
function validateValue(fieldType: FieldType, options: string[] | null, value: unknown): unknown {
  switch (fieldType) {
    case "text":
      return z.string().trim().max(2000).parse(value);
    case "number":
      return z.number().finite().parse(value);
    case "date":
      return z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
        .parse(value);
    case "boolean":
      return z.boolean().parse(value);
    case "select":
      return z
        .string()
        .refine((v) => (options ?? []).includes(v), "Not one of the field's options")
        .parse(value);
  }
}

export const setValueInput = z.object({
  definitionId: z.string().uuid(),
  entityId: z.string().uuid(),
  value: z.unknown(),
});

export async function setValue(tenantId: string, input: z.infer<typeof setValueInput>) {
  return withTenantContext(tenantId, async (tx) => {
    const [definition] = await tx
      .select()
      .from(customFieldDefinitions)
      .where(and(eq(customFieldDefinitions.tenantId, tenantId), eq(customFieldDefinitions.id, input.definitionId)));
    if (!definition) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Custom field definition not found" });
    }

    await requireEntity(tenantId, definition.entityType, input.entityId);

    let validatedValue: unknown;
    try {
      validatedValue = validateValue(definition.fieldType, definition.options, input.value);
    } catch {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid value for field "${definition.name}"` });
    }

    const [existing] = await tx
      .select({ id: customFieldValues.id })
      .from(customFieldValues)
      .where(
        and(
          eq(customFieldValues.tenantId, tenantId),
          eq(customFieldValues.definitionId, input.definitionId),
          eq(customFieldValues.entityId, input.entityId),
        ),
      );

    if (existing) {
      const [updated] = await tx
        .update(customFieldValues)
        .set({ value: validatedValue, updatedAt: new Date() })
        .where(eq(customFieldValues.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await tx
      .insert(customFieldValues)
      .values({ tenantId, definitionId: input.definitionId, entityId: input.entityId, value: validatedValue })
      .returning();
    return created;
  });
}

export async function listValuesForEntity(tenantId: string, entityType: EntityType, entityId: string) {
  const definitions = await listDefinitions(tenantId, entityType);

  const values = await withTenantContext(tenantId, (tx) =>
    tx
      .select()
      .from(customFieldValues)
      .where(and(eq(customFieldValues.tenantId, tenantId), eq(customFieldValues.entityId, entityId))),
  );
  const valueByDefinitionId = new Map(values.map((v) => [v.definitionId, v.value]));

  return definitions.map((definition) => ({
    definitionId: definition.id,
    name: definition.name,
    fieldType: definition.fieldType,
    options: definition.options,
    required: definition.required,
    value: valueByDefinitionId.get(definition.id) ?? null,
  }));
}
