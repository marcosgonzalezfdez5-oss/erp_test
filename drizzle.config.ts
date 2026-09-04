import { defineConfig } from "drizzle-kit";

if (!process.env.MIGRATIONS_DATABASE_URL) {
  throw new Error("MIGRATIONS_DATABASE_URL is not set");
}

// Migrations run as the table-owning role (DDL privileges); the app and
// tests connect via DATABASE_URL as a restricted, non-superuser role so
// Row-Level Security actually applies — see docker/postgres-init/001-app-role.sql.
export default defineConfig({
  schema: "./lib/db/schema/index.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.MIGRATIONS_DATABASE_URL,
  },
});
