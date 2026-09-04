import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "./client";

describe("db client", () => {
  it("connects to the local Postgres instance", async () => {
    const result = await db.execute(sql`select 1 as value`);
    expect(result[0]).toEqual({ value: 1 });
  });
});
