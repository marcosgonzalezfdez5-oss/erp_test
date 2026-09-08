"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { formatMoney, Money } from "@/components/money";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { isNotFoundError } from "@/lib/trpc/is-not-found";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function QuoteDetail({ quoteId }: { quoteId: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const quote = trpc.quote.get.useQuery({ id: quoteId });
  // pageSize:200 so the picker isn't capped at the product list page's default size.
  const products = trpc.product.list.useQuery({ pageSize: 200 });

  const addLineItem = trpc.quote.addLineItem.useMutation({
    onSuccess: () => {
      utils.quote.get.invalidate({ id: quoteId });
      toast.success("Line item added");
    },
    onError: (error) => toast.error(error.message),
  });
  const removeLineItem = trpc.quote.removeLineItem.useMutation({
    onSuccess: () => {
      utils.quote.get.invalidate({ id: quoteId });
      toast.success("Line item removed");
    },
    onError: (error) => toast.error(error.message),
  });
  const updateQuantity = trpc.quote.updateLineItemQuantity.useMutation({
    onSuccess: (updated) => {
      utils.quote.get.invalidate({ id: quoteId });
      setEditingQuantities((prev) => {
        const next = { ...prev };
        delete next[updated.id];
        return next;
      });
      toast.success("Quantity updated");
    },
    onError: (error) => toast.error(error.message),
  });
  const deleteQuote = trpc.quote.delete.useMutation({
    onSuccess: () => {
      toast.success("Quote deleted");
      if (quote.data) router.push(`/opportunities/${quote.data.quote.opportunityId}`);
    },
    onError: (error) => toast.error(error.message),
  });

  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [editingQuantities, setEditingQuantities] = useState<Record<string, string>>({});

  if (quote.isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (quote.isError) {
    if (isNotFoundError(quote.error)) {
      return <EmptyState title="Quote not found" description="It may have been deleted." />;
    }
    return <QueryError message="Couldn't load this quote." onRetry={() => quote.refetch()} />;
  }
  if (!quote.data) {
    // Unreachable: quote.get throws NOT_FOUND for a missing row. Kept for
    // TypeScript narrowing of quote.data below.
    return null;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Quote"
        action={
          <DeleteConfirmDialog
            trigger={
              <Button type="button" variant="outline" size="sm" className="text-destructive hover:text-destructive">
                <Trash2 /> Delete
              </Button>
            }
            title="Delete this quote?"
            description="This quote and its line items will be removed from the opportunity."
            pending={deleteQuote.isPending}
            onConfirm={() => deleteQuote.mutate({ id: quoteId })}
          />
        }
      />

      {quote.data.lineItems.length === 0 ? (
        <EmptyState title="No line items yet" description="Add a product below to start building this quote." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Qty</TableHead>
              <TableHead>Unit price</TableHead>
              <TableHead>Line total</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {quote.data.lineItems.map((item) => {
              const draft = editingQuantities[item.id];
              const isDirty = draft !== undefined && draft !== String(item.quantity);
              return (
                <TableRow key={item.id}>
                  <TableCell>{item.productName}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        min="1"
                        max="1000000"
                        step="1"
                        className="w-16"
                        aria-label={`Quantity for ${item.productName}`}
                        value={draft ?? String(item.quantity)}
                        onChange={(e) =>
                          setEditingQuantities((prev) => ({ ...prev, [item.id]: e.target.value }))
                        }
                      />
                      {isDirty && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={updateQuantity.isPending}
                          onClick={() => {
                            const parsed = Number(draft);
                            if (!Number.isInteger(parsed) || parsed < 1) return;
                            if (parsed > 1_000_000) {
                              toast.error("Quantity can't exceed 1,000,000.");
                              return;
                            }
                            updateQuantity.mutate({ id: item.id, quantity: parsed });
                          }}
                        >
                          Save
                        </Button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Money value={item.unitPrice} />
                  </TableCell>
                  <TableCell>
                    <Money value={item.lineTotal} />
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${item.productName}`}
                      onClick={() => removeLineItem.mutate({ id: item.id })}
                    >
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <p className="text-sm font-medium text-foreground">
        Total:{" "}
        <span data-testid="quote-total" className="font-mono tabular-nums">
          {formatMoney(quote.data.total)}
        </span>
      </p>

      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const parsedQuantity = Number(quantity);
          if (!productId || !Number.isInteger(parsedQuantity) || parsedQuantity < 1) return;
          if (parsedQuantity > 1_000_000) {
            toast.error("Quantity can't exceed 1,000,000.");
            return;
          }
          addLineItem.mutate({ quoteId, productId, quantity: parsedQuantity });
          setQuantity("1");
        }}
      >
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="quote-product">Product</Label>
          <select
            id="quote-product"
            className="h-8 rounded-lg border border-input bg-background px-2.5 py-1 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
          >
            <option value="" disabled>
              Select a product
            </option>
            {products.data?.items.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} ({formatMoney(product.unitPrice)})
              </option>
            ))}
          </select>
        </div>
        <div className="flex w-24 flex-col gap-1.5">
          <Label htmlFor="quote-quantity">Quantity</Label>
          <Input
            id="quote-quantity"
            type="number"
            min="1"
            max="1000000"
            step="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={addLineItem.isPending}>
          Add line item
        </Button>
      </form>
    </div>
  );
}
