"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";

export function ProductsList() {
  const utils = trpc.useUtils();
  const products = trpc.product.list.useQuery();
  const createProduct = trpc.product.create.useMutation({
    onSuccess: () => utils.product.list.invalidate(),
  });
  const [name, setName] = useState("");
  const [unitPrice, setUnitPrice] = useState("");

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const price = Number(unitPrice);
          if (!name.trim() || Number.isNaN(price) || price < 0) return;
          createProduct.mutate({ name, unitPrice: Math.round(price * 100) / 100 });
          setName("");
          setUnitPrice("");
        }}
      >
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Name
          <input
            className="rounded border border-black/10 px-3 py-2 dark:border-white/20"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="flex w-32 flex-col gap-1 text-sm">
          Unit price
          <input
            type="number"
            min="0"
            step="0.01"
            className="rounded border border-black/10 px-3 py-2 dark:border-white/20"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
          />
        </label>
        <button
          type="submit"
          className="rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
          disabled={createProduct.isPending}
        >
          Create product
        </button>
      </form>

      <ul className="flex flex-col gap-2">
        {products.data?.map((product) => (
          <li key={product.id} className="flex justify-between text-sm">
            <span>{product.name}</span>
            <span className="text-zinc-500">${product.unitPrice}</span>
          </li>
        ))}
        {products.data?.length === 0 && <li className="text-sm text-zinc-500">No products yet.</li>}
      </ul>
    </div>
  );
}
