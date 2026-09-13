"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Download, Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { EmptyState } from "@/components/empty-state";
import { EntityPicker } from "@/components/entity-picker";
import { formatMoney } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { StatusBadge } from "@/components/status-badge";
import { isNotFoundError } from "@/lib/trpc/is-not-found";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

const RECTIFICATION_REASONS: Record<string, string> = {
  R1: "R1 — legal error / invalid invoice",
  R2: "R2 — bankruptcy proceedings",
  R3: "R3 — bad debt",
  R4: "R4 — other",
  R5: "R5 — simplified invoice adjustment",
};

const TREATMENT_LABEL: Record<string, string> = {
  standard: "Standard",
  exempt: "Exempt",
  intra_community: "Intra-community",
  reverse_charge: "Reverse charge",
  export: "Export",
};

export function InvoiceDetail({ invoiceId, canManage }: { invoiceId: string; canManage: boolean }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const query = trpc.invoice.get.useQuery({ id: invoiceId });
  const invoice = query.data?.invoice;
  const isDraft = invoice?.status === "draft";
  const isCredit = invoice?.documentType === "credit_note";
  const canRectify =
    invoice?.documentType === "invoice" && ["issued", "partially_paid", "paid"].includes(invoice.status ?? "");

  const invalidate = () => utils.invoice.get.invalidate({ id: invoiceId });
  const onError = (e: { message: string }) => toast.error(e.message);

  const [productSearch, setProductSearch] = useState("");
  const products = trpc.product.list.useQuery({ page: 1, search: productSearch });
  const addLine = trpc.invoice.addLineItem.useMutation({ onSuccess: invalidate, onError });
  const updateLine = trpc.invoice.updateLineItem.useMutation({ onSuccess: invalidate, onError });
  const removeLine = trpc.invoice.removeLineItem.useMutation({ onSuccess: invalidate, onError });
  const issue = trpc.invoice.issue.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("Invoice issued");
      setIssueOpen(false);
    },
    onError,
  });
  const del = trpc.invoice.delete.useMutation({
    onSuccess: () => {
      toast.success("Draft deleted");
      router.push("/invoices");
    },
    onError,
  });
  const rectify = trpc.invoice.rectify.useMutation({
    onSuccess: (credit) => {
      toast.success(`Credit note ${credit.number} raised`);
      setRectifyOpen(false);
      utils.invoice.get.invalidate({ id: invoiceId });
    },
    onError,
  });
  const send = trpc.email.sendDocument.useMutation({
    onSuccess: () => {
      toast.success("Invoice emailed");
      setSendOpen(false);
    },
    onError,
  });

  const [issueOpen, setIssueOpen] = useState(false);
  const [rectifyOpen, setRectifyOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [reason, setReason] = useState("R1");
  const [rectNote, setRectNote] = useState("");
  const [sendTo, setSendTo] = useState("");

  const [productId, setProductId] = useState<string | null>(null);
  const [productLabel, setProductLabel] = useState<string>();
  const [qty, setQty] = useState("1");

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
      return <EmptyState title="Invoice not found" description="It may have been deleted." />;
    }
    return <QueryError message="Couldn't load this invoice." onRetry={() => query.refetch()} />;
  }
  if (!query.data || !invoice) return null;

  const { lineItems, allocations } = query.data;
  const pdfType = isCredit ? "credit-note" : "invoice";
  const docLabel = isCredit ? "Credit note" : "Invoice";
  const balance = (Number(invoice.totalAmount) - Number(invoice.amountPaid)).toFixed(2);

  return (
    <div className="flex flex-col gap-6">
      {invoice.orderId && (
        <Link
          href={`/orders/${invoice.orderId}`}
          className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to order
        </Link>
      )}

      <PageHeader
        title={invoice.number ?? `Draft ${docLabel.toLowerCase()}`}
        description={
          invoice.issueDate
            ? `Issued ${new Date(invoice.issueDate).toLocaleDateString()}`
            : `Created ${new Date(invoice.createdAt).toLocaleDateString()}`
        }
        action={
          <div className="flex flex-wrap gap-2">
            {isDraft && (
              <>
                <Dialog open={issueOpen} onOpenChange={setIssueOpen}>
                  <DialogTrigger asChild>
                    <Button disabled={lineItems.length === 0}>Issue</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Issue this invoice?</DialogTitle>
                      <DialogDescription>
                        Assigns the next number, freezes both parties&rsquo; details and the lines, and sets the due date.
                        After this the only correction is a credit note.
                      </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIssueOpen(false)}>
                        Not yet
                      </Button>
                      <Button disabled={issue.isPending} onClick={() => issue.mutate({ id: invoiceId })}>
                        Issue invoice
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  disabled={del.isPending}
                  onClick={() => del.mutate({ id: invoiceId })}
                >
                  Delete draft
                </Button>
              </>
            )}

            {!isDraft && (
              <Button asChild variant="outline">
                <a href={`/api/documents/${pdfType}/${invoiceId}/pdf`} target="_blank" rel="noreferrer">
                  <Download data-icon="inline-start" />
                  PDF
                </a>
              </Button>
            )}

            {!isDraft && !isCredit && (
              <Dialog open={sendOpen} onOpenChange={setSendOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <Send data-icon="inline-start" />
                    Send
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Email this invoice</DialogTitle>
                    <DialogDescription>The PDF is attached automatically.</DialogDescription>
                  </DialogHeader>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="send-to">Recipient</Label>
                    <Input
                      id="send-to"
                      type="email"
                      placeholder="billing@customer.com"
                      value={sendTo}
                      onChange={(e) => setSendTo(e.target.value)}
                    />
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setSendOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      disabled={!sendTo.includes("@") || send.isPending}
                      onClick={() => send.mutate({ invoiceId, toAddress: sendTo.trim() })}
                    >
                      Send
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}

            {canManage && canRectify && (
              <Dialog open={rectifyOpen} onOpenChange={setRectifyOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost">Rectify</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Raise a credit note</DialogTitle>
                    <DialogDescription>
                      Creates a full rectifying credit note against {invoice.number}. The original invoice keeps its
                      number.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="rect-reason">Reason (AEAT)</Label>
                    <Select value={reason} onValueChange={setReason}>
                      <SelectTrigger id="rect-reason" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(RECTIFICATION_REASONS).map(([code, label]) => (
                          <SelectItem key={code} value={code}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="rect-note">Note (optional)</Label>
                    <Textarea id="rect-note" rows={2} value={rectNote} onChange={(e) => setRectNote(e.target.value)} />
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setRectifyOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={rectify.isPending}
                      onClick={() =>
                        rectify.mutate({
                          id: invoiceId,
                          reason: reason as "R1" | "R2" | "R3" | "R4" | "R5",
                          note: rectNote.trim() || undefined,
                        })
                      }
                    >
                      Raise credit note
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={invoice.status} />
        {isCredit && <StatusBadge status="credit_note" label="Credit note" tone="neutral" />}
      </div>

      <dl className="grid max-w-md grid-cols-[8rem_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Customer</dt>
        <dd className="text-foreground">
          {invoice.customerName}
          {invoice.customerTaxId ? ` · ${invoice.customerTaxId}` : ""}
        </dd>
        {invoice.dueDate && (
          <>
            <dt className="text-muted-foreground">Due</dt>
            <dd className="text-foreground">{new Date(invoice.dueDate).toLocaleDateString()}</dd>
          </>
        )}
        {invoice.rectifiesInvoiceId && (
          <>
            <dt className="text-muted-foreground">Rectifies</dt>
            <dd className="text-foreground">
              <Link href={`/invoices/${invoice.rectifiesInvoiceId}`} className="text-primary hover:underline">
                original invoice
              </Link>
              {invoice.rectificationReason ? ` · ${invoice.rectificationReason}` : ""}
            </dd>
          </>
        )}
      </dl>

      {lineItems.length === 0 ? (
        <EmptyState title="No lines yet" description="Add a line below before issuing." />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="w-24">Qty</TableHead>
                <TableHead className="text-right">Unit</TableHead>
                <TableHead className="text-right">VAT %</TableHead>
                <TableHead className="text-right">Net</TableHead>
                {isDraft && <TableHead className="w-10" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {lineItems.map((line) => (
                <TableRow key={line.id}>
                  <TableCell className="font-medium text-foreground">{line.description}</TableCell>
                  <TableCell>
                    {isDraft ? (
                      <DraftQty
                        defaultValue={String(Number(line.quantity))}
                        onCommit={(v) => updateLine.mutate({ id: line.id, quantity: Number(v) })}
                      />
                    ) : (
                      <span className="font-mono tabular-nums">
                        {Number(line.quantity)} {line.unitOfMeasure}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(line.netUnitPrice)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{Number(line.taxRatePercent)}%</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(line.lineBaseAmount)}</TableCell>
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
            const q = Number(qty);
            if (!productId || Number.isNaN(q) || q <= 0) {
              toast.error("Pick a product and a positive quantity.");
              return;
            }
            addLine.mutate(
              { invoiceId, productId, quantity: q },
              {
                onSuccess: () => {
                  setProductId(null);
                  setProductLabel(undefined);
                  setQty("1");
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
            <Label htmlFor="inv-qty">Qty</Label>
            <Input id="inv-qty" type="number" min="0" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <Button type="submit" disabled={addLine.isPending}>
            <Plus data-icon="inline-start" />
            Add line
          </Button>
        </form>
      )}

      <div className="flex flex-col gap-4 self-end">
        {invoice.taxSummary && invoice.taxSummary.length > 0 && (
          <Table className="w-80">
            <TableHeader>
              <TableRow>
                <TableHead>Base</TableHead>
                <TableHead>Rate</TableHead>
                <TableHead className="text-right">VAT</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.taxSummary.map((g, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono tabular-nums">{formatMoney(g.base)}</TableCell>
                  <TableCell>
                    {g.taxTreatment === "standard"
                      ? `${Number(g.taxRatePercent)}%`
                      : TREATMENT_LABEL[g.taxTreatment] ?? g.taxTreatment}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(g.tax)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <dl className="grid w-64 grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Subtotal</dt>
          <dd className="text-right font-mono tabular-nums">{formatMoney(invoice.subtotalAmount)}</dd>
          <dt className="text-muted-foreground">VAT</dt>
          <dd className="text-right font-mono tabular-nums">{formatMoney(invoice.taxAmount)}</dd>
          {invoice.withholdingAmount !== "0.00" && (
            <>
              <dt className="text-muted-foreground">IRPF withheld</dt>
              <dd className="text-right font-mono tabular-nums">−{formatMoney(invoice.withholdingAmount)}</dd>
            </>
          )}
          <dt className="font-medium text-foreground">Total</dt>
          <dd className="text-right font-mono font-medium tabular-nums">{formatMoney(invoice.totalAmount)}</dd>
          {!isDraft && !isCredit && (
            <>
              <dt className="text-muted-foreground">Paid</dt>
              <dd className="text-right font-mono tabular-nums">{formatMoney(invoice.amountPaid)}</dd>
              <dt className="font-medium text-foreground">Balance</dt>
              <dd className="text-right font-mono font-medium tabular-nums">{formatMoney(balance)}</dd>
            </>
          )}
        </dl>
      </div>

      {allocations.length > 0 && (
        <section className="flex flex-col gap-3 border-t pt-6">
          <h2 className="font-heading text-sm font-semibold text-foreground">Payments</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Received</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead className="text-right">Applied</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allocations.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="text-muted-foreground">
                    {new Date(a.receivedDate).toLocaleDateString()}
                  </TableCell>
                  <TableCell>{a.method.replace(/_/g, " ")}</TableCell>
                  <TableCell className="text-muted-foreground">{a.reference ?? "—"}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{formatMoney(a.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3} className="font-medium text-foreground">
                  Total applied
                </TableCell>
                <TableCell className="text-right font-mono font-medium tabular-nums">
                  {formatMoney(invoice.amountPaid)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </section>
      )}
    </div>
  );
}

function DraftQty({ defaultValue, onCommit }: { defaultValue: string; onCommit: (v: string) => void }) {
  const [value, setValue] = useState(defaultValue);
  return (
    <Input
      type="number"
      min="0"
      step="0.001"
      className="h-7 w-20 px-1.5 text-right font-mono tabular-nums"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => value !== defaultValue && Number(value) > 0 && onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}
