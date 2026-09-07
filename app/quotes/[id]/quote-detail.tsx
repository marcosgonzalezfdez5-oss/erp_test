"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";

export function QuoteDetail({ quoteId }: { quoteId: string }) {
  const utils = trpc.useUtils();
  const quote = trpc.quote.get.useQuery({ id: quoteId });
  const products = trpc.product.list.useQuery();

  const addLineItem = trpc.quote.addLineItem.useMutation({
    onSuccess: () => utils.quote.get.invalidate({ id: quoteId }),
  });
  const removeLineItem = trpc.quote.removeLineItem.useMutation({
    onSuccess: () => utils.quote.get.invalidate({ id: quoteId }),
  });

  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");

  if (quote.isLoading) {
    return <p>Loading…</p>;
  }
  if (!quote.data) {
    return <p>Quote not found.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Quote</h1>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-zinc-500">
            <th className="pb-2">Product</th>
            <th className="pb-2">Qty</th>
            <th className="pb-2">Unit price</th>
            <th className="pb-2">Line total</th>
            <th className="pb-2" />
          </tr>
        </thead>
        <tbody>
          {quote.data.lineItems.map((item) => (
            <tr key={item.id}>
              <td className="py-1">{item.productName}</td>
              <td className="py-1">{item.quantity}</td>
              <td className="py-1">${item.unitPrice}</td>
              <td className="py-1">${item.lineTotal}</td>
              <td className="py-1">
                <button
                  type="button"
                  aria-label={`Remove ${item.productName}`}
                  className="text-zinc-500 underline"
                  onClick={() => removeLineItem.mutate({ id: item.id })}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {quote.data.lineItems.length === 0 && <p className="text-sm text-zinc-500">No line items yet.</p>}

      <p className="text-sm font-medium">
        Total: <span data-testid="quote-total">${quote.data.total}</span>
      </p>

      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const parsedQuantity = Number(quantity);
          if (!productId || !Number.isInteger(parsedQuantity) || parsedQuantity < 1) return;
          addLineItem.mutate({ quoteId, productId, quantity: parsedQuantity });
          setQuantity("1");
        }}
      >
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Product
          <select
            className="rounded border border-black/10 px-3 py-2 dark:border-white/20 dark:bg-black"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
          >
            <option value="" disabled>
              Select a product
            </option>
            {products.data?.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} (${product.unitPrice})
              </option>
            ))}
          </select>
        </label>
        <label className="flex w-24 flex-col gap-1 text-sm">
          Quantity
          <input
            type="number"
            min="1"
            step="1"
            className="rounded border border-black/10 px-3 py-2 dark:border-white/20"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </label>
        <button
          type="submit"
          className="rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
          disabled={addLineItem.isPending}
        >
          Add line item
        </button>
      </form>
    </div>
  );
}
