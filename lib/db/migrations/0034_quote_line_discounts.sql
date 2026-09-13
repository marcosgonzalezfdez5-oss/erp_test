ALTER TABLE "quote_line_items" ALTER COLUMN "quantity" SET DATA TYPE numeric(12, 3);--> statement-breakpoint
ALTER TABLE "quote_line_items" ALTER COLUMN "quantity" SET DEFAULT '1';--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD COLUMN "unit_of_measure" text DEFAULT 'unit' NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD COLUMN "discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD COLUMN "discount_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD COLUMN "net_unit_price" numeric(12, 2);--> statement-breakpoint
UPDATE "quote_line_items" SET "net_unit_price" = "unit_price" WHERE "net_unit_price" IS NULL;--> statement-breakpoint
ALTER TABLE "quote_line_items" ALTER COLUMN "net_unit_price" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD COLUMN "unit_cost" numeric(12, 2);