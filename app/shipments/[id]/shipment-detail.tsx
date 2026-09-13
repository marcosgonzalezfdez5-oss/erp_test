"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, Send } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { StatusBadge } from "@/components/status-badge";
import { isNotFoundError } from "@/lib/trpc/is-not-found";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type ShipmentStatus =
  | "draft"
  | "picking"
  | "packed"
  | "shipped"
  | "in_transit"
  | "delivered"
  | "cancelled"
  | "exception";

const NEXT_STATES: Record<ShipmentStatus, ShipmentStatus[]> = {
  draft: ["picking", "packed", "shipped"],
  picking: ["packed", "shipped"],
  packed: ["shipped"],
  shipped: ["in_transit", "delivered", "exception"],
  in_transit: ["delivered", "exception"],
  delivered: [],
  cancelled: [],
  exception: ["in_transit", "delivered"],
};

const ACTION_LABEL: Record<ShipmentStatus, string> = {
  draft: "Reopen",
  picking: "Start picking",
  packed: "Mark packed",
  shipped: "Mark shipped",
  in_transit: "Mark in transit",
  delivered: "Mark delivered",
  cancelled: "Cancel",
  exception: "Flag exception",
};

export function ShipmentDetail({ shipmentId, canManage }: { shipmentId: string; canManage: boolean }) {
  const utils = trpc.useUtils();
  const query = trpc.shipment.get.useQuery({ id: shipmentId });
  const shipment = query.data?.shipment;
  const preShip = shipment && ["draft", "picking", "packed"].includes(shipment.status);
  const isShipped = Boolean(shipment?.shippedAt);

  const invalidate = () => utils.shipment.get.invalidate({ id: shipmentId });
  const onError = (e: { message: string }) => toast.error(e.message);

  const transition = trpc.shipment.transition.useMutation({
    onSuccess: (s) => {
      invalidate();
      toast.success(`Shipment ${s.status.replace(/_/g, " ")}`);
    },
    onError,
  });
  const cancel = trpc.shipment.cancel.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("Shipment cancelled");
    },
    onError,
  });
  const notify = trpc.email.notifyShipment.useMutation({
    onSuccess: () => {
      toast.success("Customer notified");
      setNotifyOpen(false);
    },
    onError,
  });
  const recordReturn = trpc.return.record.useMutation({
    onSuccess: (result) => {
      invalidate();
      toast.success(result.creditNote ? `Return recorded · credit note ${result.creditNote.number}` : "Return recorded");
      setReturnOpen(false);
    },
    onError,
  });

  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyTo, setNotifyTo] = useState("");
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnQtys, setReturnQtys] = useState<Record<string, string>>({});
  const [makeCredit, setMakeCredit] = useState(true);

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (query.isError) {
    if (isNotFoundError(query.error)) {
      return <EmptyState title="Shipment not found" description="It may have been cancelled." />;
    }
    return <QueryError message="Couldn't load this shipment." onRetry={() => query.refetch()} />;
  }
  if (!query.data || !shipment) return null;

  const { lineItems } = query.data;
  const nextStates = NEXT_STATES[shipment.status as ShipmentStatus] ?? [];

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/orders/${shipment.orderId}`}
        className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to order
      </Link>

      <PageHeader
        title={shipment.number ?? "Draft shipment"}
        description={
          shipment.shippedAt
            ? `Shipped ${new Date(shipment.shippedAt).toLocaleDateString()}`
            : `Created ${new Date(shipment.createdAt).toLocaleDateString()}`
        }
        action={
          <div className="flex flex-wrap gap-2">
            {nextStates.map((next) => (
              <Button
                key={next}
                variant={next === "shipped" ? "default" : "outline"}
                disabled={transition.isPending}
                onClick={() => transition.mutate({ id: shipmentId, status: next })}
              >
                {ACTION_LABEL[next]}
              </Button>
            ))}
            {preShip && (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={cancel.isPending}
                onClick={() => cancel.mutate({ id: shipmentId })}
              >
                Cancel
              </Button>
            )}
            {isShipped && (
              <Button asChild variant="outline">
                <a href={`/api/documents/delivery-note/${shipmentId}/pdf`} target="_blank" rel="noreferrer">
                  <Download data-icon="inline-start" />
                  Delivery note
                </a>
              </Button>
            )}
            {isShipped && (
              <Dialog open={notifyOpen} onOpenChange={setNotifyOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <Send data-icon="inline-start" />
                    Notify customer
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Send a dispatch notification</DialogTitle>
                    <DialogDescription>Includes the tracking details and the delivery note PDF.</DialogDescription>
                  </DialogHeader>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="notify-to">Recipient</Label>
                    <Input
                      id="notify-to"
                      type="email"
                      placeholder="customer@example.com"
                      value={notifyTo}
                      onChange={(e) => setNotifyTo(e.target.value)}
                    />
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setNotifyOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      disabled={!notifyTo.includes("@") || notify.isPending}
                      onClick={() => notify.mutate({ shipmentId, toAddress: notifyTo.trim() })}
                    >
                      Send
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
            {canManage && isShipped && (
              <Dialog open={returnOpen} onOpenChange={setReturnOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost">Record return</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Record a customer return</DialogTitle>
                    <DialogDescription>
                      Restocks the goods at their original cost and walks back the order&rsquo;s fulfilment.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="flex flex-col gap-3">
                    {lineItems.map((line) => (
                      <div key={line.id} className="flex items-center justify-between gap-3">
                        <span className="text-sm text-foreground">{line.description}</span>
                        <Input
                          type="number"
                          min="0"
                          step="0.001"
                          className="h-8 w-24 text-right font-mono tabular-nums"
                          placeholder="0"
                          value={returnQtys[line.id] ?? ""}
                          onChange={(e) => setReturnQtys((q) => ({ ...q, [line.id]: e.target.value }))}
                        />
                      </div>
                    ))}
                    <label className="flex items-center gap-2 text-sm text-foreground">
                      <Checkbox checked={makeCredit} onCheckedChange={(c) => setMakeCredit(c === true)} />
                      Also raise a credit note against the order&rsquo;s invoice
                    </label>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setReturnOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={recordReturn.isPending}
                      onClick={() => {
                        const lines = lineItems
                          .map((line) => ({
                            shipmentLineItemId: line.id,
                            quantity: Number(returnQtys[line.id] ?? "0"),
                          }))
                          .filter((l) => l.quantity > 0);
                        if (lines.length === 0) {
                          toast.error("Enter a quantity for at least one line.");
                          return;
                        }
                        recordReturn.mutate({ shipmentId, lines, createCreditNote: makeCredit });
                      }}
                    >
                      Record return
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={shipment.status} />
      </div>

      <dl className="grid max-w-md grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Carrier</dt>
        <dd className="text-foreground">{shipment.carrier?.toUpperCase() ?? "—"}</dd>
        <dt className="text-muted-foreground">Tracking</dt>
        <dd className="text-foreground">
          {shipment.trackingUrl && shipment.trackingNumber ? (
            <a href={shipment.trackingUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
              {shipment.trackingNumber}
            </a>
          ) : (
            shipment.trackingNumber ?? "—"
          )}
        </dd>
        <dt className="text-muted-foreground">Packages</dt>
        <dd className="text-foreground">{shipment.packageCount}</dd>
      </dl>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lineItems.map((line) => (
              <TableRow key={line.id}>
                <TableCell className="font-medium text-foreground">{line.description}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{Number(line.quantity)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {preShip && (
        <p className="text-xs text-muted-foreground">
          Carrier and tracking can be edited from the order until the shipment is marked shipped.
        </p>
      )}
    </div>
  );
}
