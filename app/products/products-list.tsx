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
import { Checkbox } from "@/components/ui/checkbox";
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

const UNITS = ["unit", "kg", "g", "l", "ml", "m", "cm", "m2", "m3", "hour", "box", "pallet"] as const;

function parseMoney(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  if (Number.isNaN(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

type Fields = {
  name: string;
  sku: string;
  unitPrice: string;
  unitOfMeasure: (typeof UNITS)[number];
  costPrice: string;
  taxRatePercent: string;
  tracksInventory: boolean;
};

const EMPTY: Fields = {
  name: "",
  sku: "",
  unitPrice: "",
  unitOfMeasure: "unit",
  costPrice: "",
  taxRatePercent: "",
  tracksInventory: true,
};

function toMutationInput(f: Fields) {
  const unitPrice = parseMoney(f.unitPrice);
  if (!f.name.trim() || unitPrice === null) return null;
  return {
    name: f.name.trim(),
    sku: f.sku.trim() || undefined,
    unitPrice,
    unitOfMeasure: f.unitOfMeasure,
    costPrice: f.costPrice.trim() === "" ? null : parseMoney(f.costPrice) ?? undefined,
    taxRatePercent: f.taxRatePercent.trim() === "" ? null : Number(f.taxRatePercent),
    tracksInventory: f.tracksInventory,
  };
}

function ProductFields({ value, onChange, idPrefix }: { value: Fields; onChange: (f: Fields) => void; idPrefix: string }) {
  const set = <K extends keyof Fields>(key: K, v: Fields[K]) => onChange({ ...value, [key]: v });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-name`}>Name</Label>
        <Input id={`${idPrefix}-name`} value={value.name} onChange={(e) => set("name", e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-sku`}>SKU</Label>
        <Input id={`${idPrefix}-sku`} value={value.sku} onChange={(e) => set("sku", e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-unit`}>Unit</Label>
        <Select value={value.unitOfMeasure} onValueChange={(v) => set("unitOfMeasure", v as (typeof UNITS)[number])}>
          <SelectTrigger id={`${idPrefix}-unit`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {UNITS.map((u) => (
              <SelectItem key={u} value={u}>
                {u}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-price`}>Unit price</Label>
        <Input
          id={`${idPrefix}-price`}
          type="number"
          min="0"
          step="0.01"
          value={value.unitPrice}
          onChange={(e) => set("unitPrice", e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-cost`}>Cost price</Label>
        <Input
          id={`${idPrefix}-cost`}
          type="number"
          min="0"
          step="0.01"
          value={value.costPrice}
          onChange={(e) => set("costPrice", e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-vat`}>VAT rate %</Label>
        <Input
          id={`${idPrefix}-vat`}
          type="number"
          min="0"
          max="100"
          step="0.01"
          placeholder="Company default"
          value={value.taxRatePercent}
          onChange={(e) => set("taxRatePercent", e.target.value)}
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-2">
        <Checkbox checked={value.tracksInventory} onCheckedChange={(c) => set("tracksInventory", c === true)} />
        Track stock levels for this product
      </label>
    </div>
  );
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
      setCreate(EMPTY);
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

  const [create, setCreate] = useState<Fields>(EMPTY);
  const [formError, setFormError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Fields>(EMPTY);
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
          className="flex flex-col gap-3 rounded-md border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const input = toMutationInput(create);
            if (!input) {
              setFormError("Enter a name and a valid non-negative price.");
              return;
            }
            setFormError(null);
            createProduct.mutate(input);
          }}
        >
          <ProductFields value={create} onChange={setCreate} idPrefix="product" />
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={createProduct.isPending}>
              Create product
            </Button>
            <FieldError message={formError} />
          </div>
        </form>
      )}

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
              <div className="flex flex-col">
                <span className="text-foreground">{product.name}</span>
                <span className="text-xs text-muted-foreground">
                  {product.sku ? `${product.sku} · ` : ""}
                  per {product.unitOfMeasure}
                  {product.tracksInventory ? "" : " · not stocked"}
                </span>
              </div>
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
                          setEdit({
                            name: product.name,
                            sku: product.sku ?? "",
                            unitPrice: product.unitPrice,
                            unitOfMeasure: product.unitOfMeasure,
                            costPrice: product.costPrice ?? "",
                            taxRatePercent: product.taxRatePercent ?? "",
                            tracksInventory: product.tracksInventory,
                          });
                          setEditError(null);
                        }
                      }}
                      pending={updateProduct.isPending}
                      onSubmit={() => {
                        const input = toMutationInput(edit);
                        if (!input) {
                          setEditError("Enter a name and a valid non-negative price.");
                          return;
                        }
                        updateProduct.mutate({ id: product.id, ...input });
                      }}
                    >
                      <ProductFields value={edit} onChange={setEdit} idPrefix={`edit-${product.id}`} />
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
