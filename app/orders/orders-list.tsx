"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { EmptyState } from "@/components/empty-state";
import { EntityPicker } from "@/components/entity-picker";
import { formatMoney } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { Pager } from "@/components/pager";
import { QueryError } from "@/components/query-error";
import { SearchInput } from "@/components/search-input";
import { StatusBadge } from "@/components/status-badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

const STATUSES = ["draft", "confirmed", "partially_fulfilled", "fulfilled", "cancelled"] as const;

function NewOrderDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [accountLabel, setAccountLabel] = useState<string>();
  const [accountSearch, setAccountSearch] = useState("");
  const [notes, setNotes] = useState("");

  const accounts = trpc.account.list.useQuery({ page: 1, search: accountSearch });
  const create = trpc.order.create.useMutation({
    onSuccess: (order) => {
      toast.success("Draft order created");
      setOpen(false);
      router.push(`/orders/${order.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus data-icon="inline-start" />
          New order
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New order</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({
              accountId: accountId ?? undefined,
              notes: notes.trim() || undefined,
            });
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label>Customer</Label>
            <EntityPicker
              value={accountId}
              selectedLabel={accountLabel}
              items={(accounts.data?.items ?? []).map((a) => ({ id: a.id, label: a.name }))}
              onSearchChange={setAccountSearch}
              onSelect={(item) => {
                setAccountId(item?.id ?? null);
                setAccountLabel(item?.label);
              }}
              placeholder="Search accounts…"
            />
            <p className="text-xs text-muted-foreground">Optional — you can add a customer later.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="order-notes">Notes</Label>
            <Textarea id="order-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              Create draft
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function OrdersList() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("all");

  const orders = trpc.order.list.useQuery({
    page,
    search,
    status: status === "all" ? undefined : (status as (typeof STATUSES)[number]),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Orders"
        description="Sales orders from won opportunities and direct entry — the start of the fulfilment chain."
        action={<NewOrderDialog />}
      />

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Search by number or customer…"
        />
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
        >
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
      </div>

      {orders.isLoading && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}
      {orders.isError && <QueryError message="Couldn't load your orders." onRetry={() => orders.refetch()} />}

      {orders.data?.items.length === 0 && (
        <EmptyState
          icon={ShoppingCart}
          title={search || status !== "all" ? "No orders match" : "No orders yet"}
          description={
            search || status !== "all"
              ? "Try a different search or filter."
              : "Win an opportunity with a quote, or create one directly with “New order”."
          }
        />
      )}

      {orders.data && orders.data.items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.data.items.map((order) => (
              <TableRow key={order.id}>
                <TableCell>
                  <Link
                    href={`/orders/${order.id}`}
                    className="font-medium text-foreground hover:text-primary hover:underline"
                  >
                    {order.number ?? "Draft"}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">{order.accountName ?? "—"}</TableCell>
                <TableCell>
                  <StatusBadge status={order.status} />
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">{formatMoney(order.totalAmount)}</TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(order.createdAt).toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {orders.data && (
        <Pager page={page} pageSize={20} total={orders.data.total} onPageChange={setPage} />
      )}
    </div>
  );
}
