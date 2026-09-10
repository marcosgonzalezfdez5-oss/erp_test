import { index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenant";
import { users } from "./user";

// A record of every email the ERP sent (via Resend) — the audit trail for a
// consequential, customer-facing action (CLAUDE.md §8). Sending is triggered
// either by a human on their own reviewed draft or by approving a
// `send_follow_up_email` Suggestion.

export const emailMessageStatusEnum = pgEnum("email_message_status", ["queued", "sent", "failed"]);

export const emailMessages = pgTable(
  "email_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    // Polymorphic references, no FK — kept for the audit trail even if the
    // draft/opportunity/contact is later deleted.
    draftId: uuid("draft_id"),
    opportunityId: uuid("opportunity_id"),
    contactId: uuid("contact_id"),
    toAddress: text("to_address").notNull(),
    fromName: text("from_name"),
    replyTo: text("reply_to"),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    status: emailMessageStatusEnum("status").notNull().default("queued"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    sentByUserId: uuid("sent_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (table) => [index("email_messages_tenant_opportunity_idx").on(table.tenantId, table.opportunityId)],
);

export type EmailMessage = typeof emailMessages.$inferSelect;
export type EmailMessageStatus = (typeof emailMessageStatusEnum.enumValues)[number];
