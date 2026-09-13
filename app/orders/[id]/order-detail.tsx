"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { EmptyState } from "@/components/empty-state";
import { EntityPicker } from "@/components/entity-picker";
import { formatMoney } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { StatusBadge } from "@/components/status-badge";
import { isNotFoundError } from "@/lib/trpc/is-not-found";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

type LineItem = {
  id: string;
  description: string;
  quantity: string;
  unitOfMeasure: string;
  discountPercent: string;
  netUnitPrice: string;
  taxRatePercent: string;
  lineBaseAmount: string;
  quantityShipped: string;
  quantityInvoiced: string;
  backordered: boolean;
};

export function OrderDetail({ orderId, canManage }: { orderId: string; canManage: boolean }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const query = trpc.order.get.useQuery({ id: orderId });
  const order = query.data?.order;
  const isDraft = order?.status === "draft";

  const account = trpc.account.get.useQuery(
    { id: order?.accountId ?? "" },
    { enabled: Boolean(order?.accountId) },
  );
  const opportunity = trpc.opportunity.get.useQuery(
    { id: order?.opportunityId ?? "" },
    { enabled: Boolean(order?.opportunityId) },
  );
  const fulfillment = trpc.shipment.fulfillment.useQuery(
    { orderId },
    { enabled: Boolean(order) && order?.status !== "draft" && order?.status !== "cancelled" },
  );

  const invalidate = () => {
    utils.order.get.invalidate({ id: orderId });
    utils.shipment.fulfillment.invalidate({ orderId });
  };
  const onError = (e: { message: string }) => toast.error(e.message);

  const addLine = trpc.order.addLineItem.useMutation({ onSuccess: invalidate, onError });
  const updateLine = trpc.order.updateLineItem.useMutation({ onSuccess: invalidate, onError });
  const removeLine = trpc.order.removeLineItem.useMutation({ onSuccess: invalidate, onError });
  const confirm = trpc.order.confirm.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("Order confirmed — stock reserved");
      setConfirmOpen(false);
    },
    onError,
  });
  const cancel = trpc.order.cancel.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("Order cancelled");
      setCancelOpen(false);
    },
    onError,
  });
  const createInvoice = trpc.invoice.createFromOrder.useMutation({
    onSuccess: (invoice) => {
      utils.order.get.invalidate({ id: orderId });
      toast.success("Draft invoice created");
      router.push(`/invoices/${invoice.id}`);
    },
    onError,
  });

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [warehouseId, setWarehouseId] = useState<string>("");

  // add-line form
  const [productId, setProductId] = useState<string | null>(null);
  const [productLabel, setProductLabel] = useState<string>();
  const [productSearch, setProductSearch] = useState("");
  const [newQty, setNewQty] = useState("1");
  const [newDiscount, setNewDiscount] = useState("0");
  const products = trpc.product.list.useQuery({ page: 1, search: productSearch });
  const warehouses = trpc.warehouse.options.useQuery(undefined, { enabled: confirmOpen });

  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (query.isError) {
    if (isNotFoundError(query.error)) {
      return <EmptyState title="Order not found" description="It may have been deleted." />;
    }
    return <QueryError message="Couldn't load this order." onRetry={() => query.refetch()} />;
  }
  if (!query.data || !order) return null;

  const lineItems = query.data.lineItems as LineItem[];
  const defaultWarehouseId = warehouses.data?.find((w) => w.isDefault)?.id ?? warehouses.data?.[0]?.id ?? "";
  const chosenWarehouse = warehouseId || defaultWarehouseId;

  function saveLine(line: LineItem, patch: { quantity?: string; discountPercent?: string }) {
    const quantity = patch.quantity ?? line.quantity;
    const discountPercent = patch.discountPercent ?? line.discountPercent;
    if (quantity === line.quantity && discountPercent === line.discountPercent) return;
    const q = Number(quantity);
    const d = Number(discountPercent);
    if (Number.isNaN(q) || q <= 0 || Number.isNaN(d) || d < 0 || d > 100) {
      toast.error("Quantity must be positive and discount between 0 and 100.");
      return;
    }
    updateLine.mutate({ id: line.id, quantity: q, discountPercent: d });
  }

  return (
    <div className="flex flex-col gap-6">
      {order.opportunityId && (
        <Link
          href={`/opportunities/${order.opportunityId}`}
          className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to opportunity
        </Link>
      )}

      <PageHeader
        title={order.number ?? "Draft order"}
        description={`Created ${new Date(order.createdAt).toLocaleDateString()}`}
        action={
          <div className="flex gap-2">
            {isDraft && (
              <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <DialogTrigger asChild>
                  <Button disabled={lineItems.length === 0}>Confirm order</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Confirm this order</DialogTitle>
                    <DialogDescription>
                      Assigns the order number and reserves stock from the chosen warehouse. Lines can no longer be edited.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="confirm-warehouse">Fulfil from</Label>
                    <Select value={chosenWarehouse} onValueChange={setWarehouseId}>
                      <SelectTrigger id="confirm-warehouse" className="w-full">
                        <SelectValue placeholder="Select a warehouse" />
                      </SelectTrigger>
                      <SelectContent>
                        {(warehouses.data ?? []).map((w) => (
                          <SelectItem key={w.id} value={w.id}>
                            {w.name} ({w.code})
                            {w.isDefault ? " · default" : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      disabled={confirm.isPending || !chosenWarehouse}
                      onClick={() => confirm.mutate({ id: orderId, warehouseId: chosenWarehouse })}
                    >
                      Confirm order
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}

            {!isDraft && order.status !== "cancelled" && (
              <Button
                variant="outline"
                disabled={createInvoice.isPending || order.invoiceStatus === "invoiced"}
                onClick={() => createInvoice.mutate({ orderId })}
              >
                Create invoice
              </Button>
            )}
            {(order.status === "confirmed" || order.status === "partially_fulfilled") && (
              <Button asChild variant="outline">
                <Link href={`/shipments/new?orderId=${orderId}`}>Create shipment</Link>
              </Button>
            )}

            {canManage &&
              order.status !== "cancelled" &&
              order.status !== "fulfilled" &&
              order.status !== "partially_fulfilled" && (
                <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
                  <DialogTrigger asChild>
                    <Button variant="ghost" className="text-destructive hover:text-destructive">
                      Cancel
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Cancel this order?</DialogTitle>
                      <DialogDescription>Any reserved stock is released. This cannot be undone.</DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="cancel-reason">Reason (optional)</Label>
                      <Textarea
                        id="cancel-reason"
                        rows={2}
                        value={cancelReason}
                        onChange={(e) => setCancelReason(e.target.value)}
                      />
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setCancelOpen(false)}>
                        Keep order
                      </Button>
                      <Button
                        variant="destructive"
                        disabled={cancel.isPending}
                        onClick={() => cancel.mutate({ id: orderId, reason: cancelReason.trim() || undefined })}
                      >
                        Cancel order
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={order.status} />
        {order.status !== "draft" && order.status !== "cancelled" && (
          <>
            <StatusBadge status={order.fulfillmentStatus} />
            <StatusBadge status={order.invoiceStatus} />
          </>
        )}
      </div>

      <dl className="grid max-w-md grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Customer</dt>
        <dd className="text-foreground">
          {order.accountId ? (
            <Link href={`/accounts/${order.accountId}`} className="text-primary hover:underline">
              {account.data?.name ?? "View account"}
            </Link>
          ) : (
            "—"
          )}
        </dd>
        {order.opportunityId && (
          <>
            <dt className="text-muted-foreground">Opportunity</dt>
            <dd className="text-foreground">
              <Link href={`/opportunities/${order.opportunityId}`} className="text-primary hover:underline">
                {opportunity.data?.name ?? "View opportunity"}
              </Link>
            </dd>
          </>
        )}
      </dl>

      {lineItems.length === 0 ? (
        <EmptyState title="No lines yet" description="Add a product below to build this order." />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="w-28">Qty</TableHead>
                <TableHead className="w-24">Disc. %</TableHead>
                <TableHead className="text-right">Unit</TableHead>
                <TableHead className="text-right">Net</TableHead>
                {!isDraft && <TableHead className="text-right">Shipped</TableHead>}
                {!isDraft && <TableHead className="text-right">Invoiced</TableHead>}
                {isDraft && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {lineItems.map((line) => (
                <TableRow key={line.id}>
                  <TableCell className="font-medium text-foreground">
                    {line.description}
                    {line.backordered && (
                      <StatusBadge status="backordered" className="ml-2 align-middle" />
                    )}
                  </TableCell>
                  <TableCell>
                    {isDraft ? (
                      <LineNumberInput
                        defaultValue={String(Number(line.quantity))}
                        suffix={line.unitOfMeasure}
                        onCommit={(v) => saveLine(line, { quantity: v })}
                      />
                    ) : (
                      <span className="font-mono tabular-nums">
                        {Number(line.quantity)} {line.unitOfMeasure}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {isDraft ? (
                      <LineNumberInput
                        defaultValue={String(Number(line.discountPercent))}
                        onCommit={(v) => saveLine(line, { discountPercent: v })}
                      />
                    ) : (
                      <span className="font-mono tabular-nums">{Number(line.discountPercent)}%</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(line.netUnitPrice)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(line.lineBaseAmount)}</TableCell>
                  {!isDraft && (
                    <TableCell className="text-right font-mono tabular-nums">{Number(line.quantityShipped)}</TableCell>
                  )}
                  {!isDraft && (
                    <TableCell className="text-right font-mono tabular-nums">{Number(line.quantityInvoiced)}</TableCell>
                  )}
                  {isDraft && (
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${line.description}`}
                        className="text-destructive hover:text-destructive"
                        onClick={() => removeLine.mutate({ id: line.id })}
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {isDraft && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const q = Number(newQty);
            const d = Number(newDiscount);
            if (!productId || Number.isNaN(q) || q <= 0 || Number.isNaN(d) || d < 0 || d > 100) {
              toast.error("Pick a product, a positive quantity, and a discount from 0 to 100.");
              return;
            }
            addLine.mutate(
              { orderId, productId, quantity: q, discountPercent: d },
              {
                onSuccess: () => {
                  setProductId(null);
                  setProductLabel(undefined);
                  setNewQty("1");
                  setNewDiscount("0");
                },
              },
            );
          }}
        >
          <div className="flex min-w-56 flex-1 flex-col gap-1.5">
            <Label>Product</Label>
            <EntityPicker
              value={productId}
              selectedLabel={productLabel}
              items={(products.data?.items ?? []).map((p) => ({
                id: p.id,
                label: p.name,
                hint: formatMoney(p.unitPrice),
              }))}
              onSearchChange={setProductSearch}
              onSelect={(item) => {
                setProductId(item?.id ?? null);
                setProductLabel(item?.label);
              }}
              placeholder="Search products…"
            />
          </div>
          <div className="flex w-24 flex-col gap-1.5">
            <Label htmlFor="new-qty">Qty</Label>
            <Input id="new-qty" type="number" min="0" step="0.001" value={newQty} onChange={(e) => setNewQty(e.target.value)} />
          </div>
          <div className="flex w-24 flex-col gap-1.5">
            <Label htmlFor="new-disc">Disc. %</Label>
            <Input
              id="new-disc"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={newDiscount}
              onChange={(e) => setNewDiscount(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={addLine.isPending}>
            <Plus data-icon="inline-start" />
            Add line
          </Button>
        </form>
      )}

      <dl className="grid max-w-xs grid-cols-[1fr_auto] gap-x-4 gap-y-1 self-end text-sm">
        <dt className="text-muted-foreground">Subtotal</dt>
        <dd className="text-right font-mono tabular-nums">{formatMoney(order.subtotalAmount)}</dd>
        <dt className="text-muted-foreground">Tax</dt>
        <dd className="text-right font-mono tabular-nums">{formatMoney(order.taxAmount)}</dd>
        {order.withholdingAmount !== "0.00" && (
          <>
            <dt className="text-muted-foreground">Withholding</dt>
            <dd className="text-right font-mono tabular-nums">−{formatMoney(order.withholdingAmount)}</dd>
          </>
        )}
        <dt className="font-medium text-foreground">Total</dt>
        <dd className="text-right font-mono font-medium tabular-nums" data-testid="order-total">
          {formatMoney(order.totalAmount)}
        </dd>
      </dl>

      {fulfillment.data && fulfillment.data.lines.length > 0 && (
        <section className="flex flex-col gap-3 border-t pt-6">
          <h2 className="font-heading text-sm font-semibold text-foreground">Fulfilment</h2>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Ordered</TableHead>
                  <TableHead className="text-right">Shipped</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fulfillment.data.lines.map((line) => (
                  <TableRow key={line.orderLineItemId}>
                    <TableCell>{line.description}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{Number(line.ordered)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{Number(line.shipped)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{Number(line.remaining)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {fulfillment.data.shipments.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {fulfillment.data.shipments.map((s) => (
                <li key={s.id} className="flex items-center gap-2">
                  <Link href={`/shipments/${s.id}`} className="text-primary hover:underline">
                    {s.number ?? "Draft shipment"}
                  </Link>
                  <StatusBadge status={s.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function LineNumberInput({
  defaultValue,
  suffix,
  onCommit,
}: {
  defaultValue: string;
  suffix?: string;
  onCommit: (value: string) => void;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <div className="flex items-center gap-1">
      <Input
        type="number"
        min="0"
        step="0.001"
        className="h-7 w-16 px-1.5 text-right font-mono tabular-nums"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => value !== defaultValue && onCommit(value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
    </div>
  );
}
