CREATE TYPE "public"."sequence_kind" AS ENUM('order', 'delivery_note', 'invoice', 'credit_note');--> statement-breakpoint
CREATE TABLE "tenant_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_name" text,
	"tax_id" text,
	"legal_address" jsonb,
	"default_currency" text DEFAULT 'EUR' NOT NULL,
	"default_tax_rate_percent" numeric(5, 2) DEFAULT '21.00' NOT NULL,
	"irpf_enabled" boolean DEFAULT false NOT NULL,
	"irpf_rate_percent" numeric(5, 2) DEFAULT '15.00' NOT NULL,
	"order_number_format" text DEFAULT 'SO-{YYYY}-{SEQ:4}' NOT NULL,
	"delivery_note_number_format" text DEFAULT 'DN-{YYYY}-{SEQ:4}' NOT NULL,
	"invoice_number_format" text DEFAULT 'INV-{YYYY}-{SEQ:4}' NOT NULL,
	"credit_note_number_format" text DEFAULT 'REC-{YYYY}-{SEQ:4}' NOT NULL,
	"default_payment_terms_days" integer DEFAULT 30 NOT NULL,
	"allow_negative_stock" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "sequence_kind" NOT NULL,
	"period" integer NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"summary" text NOT NULL,
	"diff" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"address" jsonb,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log_entries" ADD CONSTRAINT "audit_log_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log_entries" ADD CONSTRAINT "audit_log_entries_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_settings_tenant_unique" ON "tenant_settings" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sequences_tenant_kind_period_unique" ON "sequences" USING btree ("tenant_id","kind","period");--> statement-breakpoint
CREATE INDEX "audit_log_entries_tenant_entity_idx" ON "audit_log_entries" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_log_entries_tenant_created_idx" ON "audit_log_entries" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "warehouses_tenant_code_unique" ON "warehouses" USING btree ("tenant_id","code") WHERE "warehouses"."deleted_at" is null;