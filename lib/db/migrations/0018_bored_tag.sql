CREATE TYPE "public"."suggestion_kind" AS ENUM('create_pipeline_stage', 'create_custom_field_definition', 'move_opportunity_stage', 'create_task', 'send_follow_up_email');--> statement-breakpoint
CREATE TYPE "public"."suggestion_source" AS ENUM('setup_wizard', 'automation', 'ai_assist', 'manual');--> statement-breakpoint
CREATE TYPE "public"."suggestion_status" AS ENUM('pending', 'approved', 'rejected', 'superseded');--> statement-breakpoint
CREATE TABLE "suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source" "suggestion_source" NOT NULL,
	"kind" "suggestion_kind" NOT NULL,
	"status" "suggestion_status" DEFAULT 'pending' NOT NULL,
	"payload" jsonb NOT NULL,
	"rationale" text,
	"target_entity_type" text,
	"target_entity_id" uuid,
	"group_key" text,
	"created_by_user_id" uuid,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "suggestions_tenant_status_idx" ON "suggestions" USING btree ("tenant_id","status");