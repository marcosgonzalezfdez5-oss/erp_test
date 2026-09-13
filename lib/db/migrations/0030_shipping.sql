CREATE TYPE "public"."order_fulfillment_status" AS ENUM('unfulfilled', 'partially_fulfilled', 'fulfilled');--> statement-breakpoint
CREATE TYPE "public"."carrier" AS ENUM('ups', 'fedex', 'dhl', 'gls', 'seur', 'correos', 'mrw', 'nacex', 'other');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('draft', 'picking', 'packed', 'shipped', 'in_transit', 'delivered', 'cancelled', 'exception');--> statement-breakpoint
CREATE TABLE "shipment_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"shipment_id" uuid NOT NULL,
	"order_line_item_id" uuid NOT NULL,
	"product_id" uuid,
	"description" text NOT NULL,
	"unit_cost" numeric(12, 2),
	"quantity" numeric(12, 3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"ship_from_warehouse_id" uuid NOT NULL,
	"number" text,
	"status" "shipment_status" DEFAULT 'draft' NOT NULL,
	"carrier" "carrier",
	"service" text,
	"tracking_number" text,
	"tracking_url" text,
	"ship_to_address" jsonb,
	"package_count" integer DEFAULT 1 NOT NULL,
	"weight_grams" integer,
	"shipping_cost" numeric(12, 2),
	"notes" text,
	"stock_applied_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "fulfillment_status" "order_fulfillment_status" DEFAULT 'unfulfilled' NOT NULL;--> statement-breakpoint
ALTER TABLE "shipment_line_items" ADD CONSTRAINT "shipment_line_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_line_items" ADD CONSTRAINT "shipment_line_items_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_line_items" ADD CONSTRAINT "shipment_line_items_order_line_item_id_order_line_items_id_fk" FOREIGN KEY ("order_line_item_id") REFERENCES "public"."order_line_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_line_items" ADD CONSTRAINT "shipment_line_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_ship_from_warehouse_id_warehouses_id_fk" FOREIGN KEY ("ship_from_warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shipments_tenant_order_idx" ON "shipments" USING btree ("tenant_id","order_id");