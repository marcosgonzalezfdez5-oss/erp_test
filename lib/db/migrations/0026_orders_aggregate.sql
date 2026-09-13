CREATE TYPE "public"."tax_treatment" AS ENUM('standard', 'exempt', 'intra_community', 'reverse_charge', 'export');--> statement-breakpoint
CREATE TYPE "public"."unit_of_measure" AS ENUM('unit', 'kg', 'g', 'l', 'ml', 'm', 'cm', 'm2', 'm3', 'hour', 'box', 'pallet');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('draft', 'confirmed', 'partially_fulfilled', 'fulfilled', 'cancelled');--> statement-breakpoint
CREATE TABLE "order_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"description" text NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit_of_measure" text DEFAULT 'unit' NOT NULL,
	"list_unit_price" numeric(12, 2) NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(12, 2),
	"net_unit_price" numeric(12, 2) NOT NULL,
	"tax_rate_percent" numeric(5, 2) NOT NULL,
	"tax_treatment" "tax_treatment" DEFAULT 'standard' NOT NULL,
	"subject_to_withholding" boolean DEFAULT false NOT NULL,
	"unit_cost" numeric(12, 2),
	"line_base_amount" numeric(12, 2) NOT NULL,
	"quantity_shipped" numeric(12, 3) DEFAULT '0' NOT NULL,
	"quantity_invoiced" numeric(12, 3) DEFAULT '0' NOT NULL,
	"backordered" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" DROP CONSTRAINT "orders_opportunity_id_unique";--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "opportunity_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "unit_of_measure" "unit_of_measure" DEFAULT 'unit' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "cost_price" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "tax_rate_percent" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "tax_treatment" "tax_treatment" DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "subject_to_withholding" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "tracks_inventory" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "reorder_point" numeric(12, 3);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "quote_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "number" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "status" "order_status" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "warehouse_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "currency" text DEFAULT 'EUR' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "subtotal_amount" numeric(12, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tax_amount" numeric(12, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "withholding_amount" numeric(12, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "total_amount" numeric(12, 2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tax_summary" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "billing_address" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "shipping_address" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "products_tenant_sku_unique" ON "products" USING btree ("tenant_id","sku") WHERE "products"."sku" is not null and "products"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_opportunity_unique" ON "orders" USING btree ("opportunity_id") WHERE "orders"."opportunity_id" is not null;