"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Receipt } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { EmptyState } from "@/components/empty-state";
import { EntityPicker } from "@/components/entity-picker";
import { formatMoney } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { SearchInput } from "@/components/search-input";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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

const STATUSES = ["draft", "issued", "partially_paid", "paid", "void", "uncollectible"] as const;

function NewInvoiceDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [accountLabel, setAccountLabel] = useState<string>();
  const [accountSearch, setAccountSearch] = useState("");
  const accounts = trpc.account.list.useQuery({ page: 1, search: accountSearch });
  const create = trpc.invoice.createBlank.useMutation({
    onSuccess: (invoice) => {
      toast.success("Draft invoice created");
      setOpen(false);
      router.push(`/invoices/${invoice.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus data-icon="inline-start" />
          New invoice
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New invoice</DialogTitle>
        </DialogHeader>
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
          <p className="text-xs text-muted-foreground">
            For invoices tied to an order, use “Create invoice” on the order instead.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={!accountId || create.isPending} onClick={() => accountId && create.mutate({ accountId })}>
            Create draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function InvoicesList() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [docType, setDocType] = useState("all");

  const invoices = trpc.invoice.list.useQuery({
    page: 1,
    search,
    status: status === "all" ? undefined : (status as (typeof STATUSES)[number]),
    documentType: docType === "all" ? undefined : (docType as "invoice" | "credit_note"),
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Invoices"
        description="Issued invoices and credit notes, plus drafts waiting to go out."
        action={<NewInvoiceDialog />}
      />

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search by number or customer…" />
        <Select value={docType} onValueChange={setDocType}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All documents</SelectItem>
            <SelectItem value="invoice">Invoices</SelectItem>
            <SelectItem value="credit_note">Credit notes</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40">
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

      {invoices.isLoading && <Skeleton className="h-40 w-full" />}
      {invoices.isError && <QueryError message="Couldn't load your invoices." onRetry={() => invoices.refetch()} />}

      {invoices.data?.items.length === 0 && (
        <EmptyState
          icon={Receipt}
          title="No invoices match"
          description="Create one from a confirmed order, or start a blank draft with “New invoice”."
        />
      )}

      {invoices.data && invoices.data.items.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Number</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead>Due</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.data.items.map((invoice) => (
              <TableRow key={invoice.id}>
                <TableCell>
                  <Link
                    href={`/invoices/${invoice.id}`}
                    className="font-medium text-foreground hover:text-primary hover:underline"
                  >
                    {invoice.number ?? "Draft"}
                  </Link>
                  {invoice.documentType === "credit_note" && (
                    <span className="ml-2 text-xs text-muted-foreground">credit note</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{invoice.customerName}</TableCell>
                <TableCell className="flex items-center gap-1.5">
                  <StatusBadge status={invoice.status} />
                  {invoice.overdue && <StatusBadge status="overdue" />}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">{formatMoney(invoice.totalAmount)}</TableCell>
                <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                  {formatMoney(invoice.amountPaid)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
