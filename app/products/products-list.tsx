"use client";

import { useState } from "react";
import { Package, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { EditDialog } from "@/components/edit-dialog";
import { EmptyState } from "@/components/empty-state";
import { FieldError } from "@/components/field-error";
import { Money } from "@/components/money";
import { Pager } from "@/components/pager";
import { QueryError } from "@/components/query-error";
import { SearchInput } from "@/components/search-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

function parsePrice(raw: string): number | null {
  const price = Number(raw);
  if (raw.trim() === "" || Number.isNaN(price) || price < 0) return null;
  return Math.round(price * 100) / 100;
}

export function ProductsList({ canManage }: { canManage: boolean }) {
  const utils = trpc.useUtils();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const products = trpc.product.list.useQuery({ page, search });

  const createProduct = trpc.product.create.useMutation({
    onSuccess: () => {
      utils.product.list.invalidate();
      toast.success("Product created");
    },
    onError: (error) => toast.error(error.message),
  });
  const updateProduct = trpc.product.update.useMutation({
    onSuccess: () => {
      utils.product.list.invalidate();
      setEditingId(null);
      toast.success("Product updated");
    },
    onError: (error) => toast.error(error.message),
  });
  const deleteProduct = trpc.product.delete.useMutation({
    onSuccess: () => {
      utils.product.list.invalidate();
      toast.success("Product deleted");
    },
    onError: (error) => toast.error(error.message),
  });

  const [name, setName] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-6">
      {!canManage && (
        <p className="text-sm text-muted-foreground">
          You can browse the catalog and add these products to quotes. Editing the catalog requires manager or admin
          access.
        </p>
      )}
      {canManage && (
      <form
        className="flex items-start gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const price = parsePrice(unitPrice);
          if (!name.trim() || price === null) {
            setFormError("Enter a name and a valid non-negative price.");
            return;
          }
          setFormError(null);
          createProduct.mutate({ name, unitPrice: price });
          setName("");
          setUnitPrice("");
        }}
      >
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="product-name">Name</Label>
          <Input
            id="product-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setFormError(null);
            }}
          />
        </div>
        <div className="flex w-32 flex-col gap-1.5">
          <Label htmlFor="product-unit-price">Unit price</Label>
          <Input
            id="product-unit-price"
            type="number"
            min="0"
            step="0.01"
            value={unitPrice}
            onChange={(e) => {
              setUnitPrice(e.target.value);
              setFormError(null);
            }}
          />
        </div>
        <Button type="submit" className="mt-[26px]" disabled={createProduct.isPending}>
          Create product
        </Button>
      </form>
      )}
      {canManage && <FieldError message={formError} />}

      <SearchInput
        value={search}
        onChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        placeholder="Search products…"
      />

      {products.isLoading && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}

      {products.isError && <QueryError message="Couldn't load your products." onRetry={() => products.refetch()} />}

      {products.data?.items.length === 0 && (
        <EmptyState
          icon={Package}
          title={search ? "No products match your search" : "No products yet"}
          description={search ? "Try a different search term." : "Add products so they can be added to quotes."}
        />
      )}

      {products.data && products.data.items.length > 0 && (
        <ul className="flex flex-col divide-y rounded-md border">
          {products.data.items.map((product) => (
            <li key={product.id} className="flex items-center justify-between px-3 py-2.5 text-sm">
              <span className="text-foreground">{product.name}</span>
              <div className="flex items-center gap-3">
                <Money value={product.unitPrice} className="text-muted-foreground" />
                {canManage && (
                <div className="flex shrink-0 gap-1">
                  <EditDialog
                    trigger={
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit ${product.name}`}>
                        <Pencil />
                      </Button>
                    }
                    title="Edit product"
                    open={editingId === product.id}
                    onOpenChange={(open) => {
                      setEditingId(open ? product.id : null);
                      if (open) {
                        setEditName(product.name);
                        setEditPrice(product.unitPrice);
                        setEditError(null);
                      }
                    }}
                    pending={updateProduct.isPending}
                    onSubmit={() => {
                      const price = parsePrice(editPrice);
                      if (!editName.trim() || price === null) {
                        setEditError("Enter a name and a valid non-negative price.");
                        return;
                      }
                      updateProduct.mutate({ id: product.id, name: editName, unitPrice: price });
                    }}
                  >
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`edit-product-name-${product.id}`}>Name</Label>
                      <Input
                        id={`edit-product-name-${product.id}`}
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`edit-product-price-${product.id}`}>Unit price</Label>
                      <Input
                        id={`edit-product-price-${product.id}`}
                        type="number"
                        min="0"
                        step="0.01"
                        value={editPrice}
                        onChange={(e) => setEditPrice(e.target.value)}
                      />
                    </div>
                    <FieldError message={editError} />
                  </EditDialog>
                  <DeleteConfirmDialog
                    trigger={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete ${product.name}`}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 />
                      </Button>
                    }
                    title={`Delete "${product.name}"?`}
                    description="This product will be removed from your active list. Existing quotes referencing it keep their snapshot price."
                    pending={deleteProduct.isPending}
                    onConfirm={() => deleteProduct.mutate({ id: product.id })}
                  />
                </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {products.data && (
        // 20 mirrors productService.PAGE_SIZE (lib/services/product.ts).
        <Pager page={page} pageSize={20} total={products.data.total} onPageChange={setPage} />
      )}
    </div>
  );
}
