import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * One visual vocabulary for every document lifecycle in the ERP chain — orders,
 * shipments, invoices, and the derived fulfilment / invoicing states. The tone,
 * not the exact label, is what the user learns to read at a glance:
 *
 *   neutral   nothing has happened yet (draft, uninvoiced)
 *   progress  in flight (confirmed, packed, issued, partially_*)
 *   positive  finished well (fulfilled, delivered, paid, invoiced)
 *   negative  finished badly / stopped (cancelled, void, uncollectible)
 *   warning   needs a human to look (overdue, backordered, exception, low stock)
 */
export type StatusTone = "neutral" | "progress" | "positive" | "negative" | "warning";

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: "bg-secondary text-secondary-foreground",
  progress: "border-border bg-transparent text-foreground",
  positive: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400",
  negative: "bg-destructive/10 text-destructive",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
};

const KNOWN: Record<string, { label: string; tone: StatusTone }> = {
  // order.status
  draft: { label: "Draft", tone: "neutral" },
  confirmed: { label: "Confirmed", tone: "progress" },
  partially_fulfilled: { label: "Partly fulfilled", tone: "progress" },
  fulfilled: { label: "Fulfilled", tone: "positive" },
  cancelled: { label: "Cancelled", tone: "negative" },
  // order.fulfillmentStatus
  unfulfilled: { label: "Unfulfilled", tone: "neutral" },
  // order.invoiceStatus
  uninvoiced: { label: "Uninvoiced", tone: "neutral" },
  partially_invoiced: { label: "Partly invoiced", tone: "progress" },
  invoiced: { label: "Invoiced", tone: "positive" },
  // shipment.status
  picking: { label: "Picking", tone: "progress" },
  packed: { label: "Packed", tone: "progress" },
  shipped: { label: "Shipped", tone: "progress" },
  in_transit: { label: "In transit", tone: "progress" },
  delivered: { label: "Delivered", tone: "positive" },
  exception: { label: "Exception", tone: "warning" },
  // invoice.status
  issued: { label: "Issued", tone: "progress" },
  partially_paid: { label: "Partly paid", tone: "progress" },
  paid: { label: "Paid", tone: "positive" },
  void: { label: "Void", tone: "negative" },
  uncollectible: { label: "Uncollectible", tone: "negative" },
  // ad-hoc flags
  overdue: { label: "Overdue", tone: "warning" },
  backordered: { label: "Backordered", tone: "warning" },
  low_stock: { label: "Low stock", tone: "warning" },
};

function sentenceCase(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function StatusBadge({
  status,
  tone,
  label,
  className,
}: {
  status: string;
  /** Override the tone the status maps to. */
  tone?: StatusTone;
  /** Override the display label. */
  label?: string;
  className?: string;
}) {
  const known = KNOWN[status];
  const resolvedTone = tone ?? known?.tone ?? "neutral";
  return (
    <Badge variant="outline" className={cn("border-transparent", TONE_CLASS[resolvedTone], className)}>
      {label ?? known?.label ?? sentenceCase(status)}
    </Badge>
  );
}
