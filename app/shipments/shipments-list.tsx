"use client";

import { useState } from "react";
import Link from "next/link";
import { Truck } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { StatusBadge } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const STATUSES = ["draft", "picking", "packed", "shipped", "in_transit", "delivered", "cancelled", "exception"] as const;

export function ShipmentsList() {
  const [status, setStatus] = useState("all");
  const shipments = trpc.shipment.list.useQuery({
    page: 1,
    status: status === "all" ? undefined : (status as (typeof STATUSES)[number]),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Shipments"
        description="Physical dispatches against your orders. Start one from a confirmed order."
      />

      <Select value={status} onValueChange={setStatus}>
        <SelectTrigger className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          {STATUSES.map((s) => (
            <SelectItem key={s} value={s}>
              {s.replace(/_/g, " ")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {shipments.isLoading && <Skeleton className="h-40 w-full" />}
      {shipments.isError && <QueryError message="Couldn't load your shipments." onRetry={() => shipments.refetch()} />}

      {shipments.data?.length === 0 && (
        <EmptyState
          icon={Truck}
          title="No shipments yet"
          description="Open a confirmed order and choose “Create shipment”."
        />
      )}

      {shipments.data && shipments.data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Delivery note</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Carrier</TableHead>
              <TableHead>Tracking</TableHead>
              <TableHead>Shipped</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shipments.data.map((shipment) => (
              <TableRow key={shipment.id}>
                <TableCell>
                  <Link
                    href={`/shipments/${shipment.id}`}
                    className="font-medium text-foreground hover:text-primary hover:underline"
                  >
                    {shipment.number ?? "Draft"}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <Link href={`/orders/${shipment.orderId}`} className="hover:text-foreground hover:underline">
                    {shipment.orderNumber ?? "—"}
                  </Link>
                </TableCell>
                <TableCell>
                  <StatusBadge status={shipment.status} />
                </TableCell>
                <TableCell className="text-muted-foreground">{shipment.carrier?.toUpperCase() ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{shipment.trackingNumber ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  {shipment.shippedAt ? new Date(shipment.shippedAt).toLocaleDateString() : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
