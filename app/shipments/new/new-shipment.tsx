"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { CARRIERS } from "@/lib/shipping/carriers";
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

export function NewShipment() {
  const router = useRouter();
  const orderId = useSearchParams().get("orderId") ?? "";

  const fulfillment = trpc.shipment.fulfillment.useQuery({ orderId }, { enabled: Boolean(orderId) });
  const warehouses = trpc.warehouse.options.useQuery();
  const create = trpc.shipment.create.useMutation({
    onSuccess: ({ shipment }) => {
      toast.success("Draft shipment created");
      router.push(`/shipments/${shipment.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [warehouseId, setWarehouseId] = useState("");
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");

  if (!orderId) {
    return <EmptyState title="No order chosen" description="Start a shipment from a confirmed order's page." />;
  }
  if (fulfillment.isLoading) return <Skeleton className="h-64 w-full" />;
  if (fulfillment.isError) {
    return <QueryError message="Couldn't load the order." onRetry={() => fulfillment.refetch()} />;
  }
  if (!fulfillment.data) return null;

  const lines = fulfillment.data.lines;
  const defaultWarehouse = warehouses.data?.find((w) => w.isDefault)?.id ?? warehouses.data?.[0]?.id ?? "";
  const chosenWarehouse = warehouseId || defaultWarehouse;
  const qtyFor = (id: string, remaining: string) => qtys[id] ?? String(Number(remaining));

  function submit() {
    const payloadLines = lines
      .map((line) => ({
        orderLineItemId: line.orderLineItemId,
        quantity: Number(qtyFor(line.orderLineItemId, line.remaining)),
      }))
      .filter((l) => l.quantity > 0);
    if (payloadLines.length === 0) {
      toast.error("Enter a quantity for at least one line.");
      return;
    }
    create.mutate({
      orderId,
      shipFromWarehouseId: chosenWarehouse || undefined,
      lines: payloadLines,
      carrier: carrier ? (carrier as (typeof CARRIERS)[number]) : undefined,
      trackingNumber: tracking.trim() || undefined,
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/orders/${orderId}`}
        className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to order
      </Link>
      <PageHeader title="New shipment" description="Pick the quantities going out in this dispatch." />

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Remaining</TableHead>
              <TableHead className="w-32">Ship now</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.orderLineItemId}>
                <TableCell className="font-medium text-foreground">{line.description}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{Number(line.remaining)}</TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min="0"
                    step="0.001"
                    className="h-8 w-24 text-right font-mono tabular-nums"
                    value={qtyFor(line.orderLineItemId, line.remaining)}
                    onChange={(e) => setQtys((q) => ({ ...q, [line.orderLineItemId]: e.target.value }))}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ship-wh">Ship from</Label>
          <Select value={chosenWarehouse} onValueChange={setWarehouseId}>
            <SelectTrigger id="ship-wh" className="w-full">
              <SelectValue placeholder="Warehouse" />
            </SelectTrigger>
            <SelectContent>
              {(warehouses.data ?? []).map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name} ({w.code})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ship-carrier">Carrier</Label>
          <Select value={carrier} onValueChange={setCarrier}>
            <SelectTrigger id="ship-carrier" className="w-full">
              <SelectValue placeholder="Optional" />
            </SelectTrigger>
            <SelectContent>
              {CARRIERS.map((c) => (
                <SelectItem key={c} value={c}>
                  {c.toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ship-tracking">Tracking number</Label>
          <Input id="ship-tracking" value={tracking} onChange={(e) => setTracking(e.target.value)} />
        </div>
      </div>

      <div>
        <Button disabled={create.isPending || !chosenWarehouse} onClick={submit}>
          Create draft shipment
        </Button>
      </div>
    </div>
  );
}
