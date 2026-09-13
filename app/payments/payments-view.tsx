"use client";

import { useState } from "react";
import { Banknote } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { EmptyState } from "@/components/empty-state";
import { EntityPicker } from "@/components/entity-picker";
import { formatMoney } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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

const METHODS = ["bank_transfer", "card", "cash", "direct_debit", "cheque", "other"] as const;

function RecordPaymentDialog({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [accountLabel, setAccountLabel] = useState<string>();
  const [accountSearch, setAccountSearch] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<(typeof METHODS)[number]>("bank_transfer");
  const [reference, setReference] = useState("");
  const [allocs, setAllocs] = useState<Record<string, string>>({});

  const accounts = trpc.account.list.useQuery({ page: 1, search: accountSearch });
  const balance = trpc.payment.accountBalance.useQuery({ accountId: accountId ?? "" }, { enabled: Boolean(accountId) });
  const openInvoices = trpc.invoice.list.useQuery(
    { page: 1, accountId: accountId ?? "", documentType: "invoice" },
    { enabled: Boolean(accountId) },
  );

  const record = trpc.payment.record.useMutation({
    onSuccess: () => {
      toast.success("Payment recorded");
      setOpen(false);
      setAccountId(null);
      setAccountLabel(undefined);
      setAmount("");
      setReference("");
      setAllocs({});
      onDone();
    },
    onError: (e) => toast.error(e.message),
  });

  const payable = (openInvoices.data?.items ?? []).filter(
    (i) => (i.status === "issued" || i.status === "partially_paid") && Number(i.totalAmount) - Number(i.amountPaid) > 0,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Record payment</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a payment</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Account</Label>
            <EntityPicker
              value={accountId}
              selectedLabel={accountLabel}
              items={(accounts.data?.items ?? []).map((a) => ({ id: a.id, label: a.name }))}
              onSearchChange={setAccountSearch}
              onSelect={(item) => {
                setAccountId(item?.id ?? null);
                setAccountLabel(item?.label);
                setAllocs({});
              }}
              placeholder="Search accounts…"
            />
            {balance.data && (
              <p className="text-xs text-muted-foreground">
                Outstanding {formatMoney(balance.data.outstanding)} · unapplied credit{" "}
                {formatMoney(balance.data.unappliedCredit)}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pay-amount">Amount</Label>
              <Input
                id="pay-amount"
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pay-method">Method</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as (typeof METHODS)[number])}>
                <SelectTrigger id="pay-method" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pay-ref">Reference</Label>
            <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>

          {payable.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-foreground">Apply to invoices</span>
              {payable.map((inv) => {
                const outstanding = (Number(inv.totalAmount) - Number(inv.amountPaid)).toFixed(2);
                return (
                  <div key={inv.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-muted-foreground">
                      {inv.number ?? "Draft"} · {formatMoney(outstanding)} due
                    </span>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      className="h-8 w-28 text-right font-mono tabular-nums"
                      placeholder="0.00"
                      value={allocs[inv.id] ?? ""}
                      onChange={(e) => setAllocs((a) => ({ ...a, [inv.id]: e.target.value }))}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={record.isPending}
            onClick={() => {
              const amt = Number(amount);
              if (!accountId || Number.isNaN(amt) || amt <= 0) {
                toast.error("Pick an account and a positive amount.");
                return;
              }
              const allocations = Object.entries(allocs)
                .map(([invoiceId, raw]) => ({ invoiceId, amount: Number(raw) }))
                .filter((a) => a.amount > 0);
              record.mutate({
                accountId,
                amount: amt,
                method,
                reference: reference.trim() || undefined,
                allocations,
              });
            }}
          >
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PaymentsView() {
  const utils = trpc.useUtils();
  const payments = trpc.payment.list.useQuery(undefined);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Payments"
        description="Customer payments and how they're applied across open invoices."
        action={<RecordPaymentDialog onDone={() => utils.payment.list.invalidate()} />}
      />

      {payments.isLoading && <Skeleton className="h-40 w-full" />}
      {payments.isError && <QueryError message="Couldn't load payments." onRetry={() => payments.refetch()} />}

      {payments.data?.length === 0 && (
        <EmptyState icon={Banknote} title="No payments yet" description="Record your first customer payment above." />
      )}

      {payments.data && payments.data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Received</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.data.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="text-muted-foreground">
                  {new Date(p.receivedDate).toLocaleDateString()}
                </TableCell>
                <TableCell className="font-medium text-foreground">{p.accountName ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{p.method.replace(/_/g, " ")}</TableCell>
                <TableCell className="text-muted-foreground">{p.reference ?? "—"}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{formatMoney(p.amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
