"use client";

import { useState } from "react";
import { Boxes } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { EmptyState } from "@/components/empty-state";
import { EntityPicker } from "@/components/entity-picker";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

type Movement = "receive" | "adjust" | "transfer";

function WarehouseSelect({
  id,
  value,
  onChange,
  placeholder = "Warehouse",
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const warehouses = trpc.warehouse.options.useQuery();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {(warehouses.data ?? []).map((w) => (
          <SelectItem key={w.id} value={w.id}>
            {w.name} ({w.code})
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ProductField({
  productId,
  productLabel,
  onSelect,
}: {
  productId: string | null;
  productLabel?: string;
  onSelect: (item: { id: string; label: string } | null) => void;
}) {
  const [search, setSearch] = useState("");
  const products = trpc.product.list.useQuery({ page: 1, search });
  return (
    <div className="flex flex-col gap-1.5">
      <Label>Product</Label>
      <EntityPicker
        value={productId}
        selectedLabel={productLabel}
        items={(products.data?.items ?? [])
          .filter((p) => p.tracksInventory)
          .map((p) => ({ id: p.id, label: p.name, hint: p.sku ?? undefined }))}
        onSearchChange={setSearch}
        onSelect={onSelect}
        placeholder="Search stocked products…"
      />
    </div>
  );
}

function MovementDialog({ kind, onDone }: { kind: Movement; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [productId, setProductId] = useState<string | null>(null);
  const [productLabel, setProductLabel] = useState<string>();
  const [warehouseId, setWarehouseId] = useState("");
  const [toWarehouseId, setToWarehouseId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");

  const reset = () => {
    setProductId(null);
    setProductLabel(undefined);
    setWarehouseId("");
    setToWarehouseId("");
    setQuantity("");
    setNote("");
  };
  const close = () => {
    setOpen(false);
    reset();
    onDone();
  };
  const onError = (e: { message: string }) => toast.error(e.message);
  const done = (message: string) => {
    toast.success(message);
    close();
  };
  const receive = trpc.inventory.receive.useMutation({ onSuccess: () => done("Stock received"), onError });
  const adjust = trpc.inventory.adjust.useMutation({ onSuccess: () => done("Stock adjusted"), onError });
  const transfer = trpc.inventory.transfer.useMutation({ onSuccess: () => done("Stock transferred"), onError });
  const pending = receive.isPending || adjust.isPending || transfer.isPending;

  const title = kind === "receive" ? "Receive stock" : kind === "adjust" ? "Adjust stock" : "Transfer stock";

  function submit() {
    const q = Number(quantity);
    if (!productId || Number.isNaN(q)) {
      toast.error("Pick a product and enter a quantity.");
      return;
    }
    if (kind === "receive") {
      if (q <= 0 || !warehouseId) return toast.error("Choose a warehouse and a positive quantity.");
      receive.mutate({ productId, warehouseId, quantity: q, note: note.trim() || undefined });
    } else if (kind === "adjust") {
      if (q < 0 || !warehouseId || !note.trim()) return toast.error("Adjustments need a warehouse, a count, and a reason.");
      adjust.mutate({ productId, warehouseId, newOnHand: q, note: note.trim() });
    } else {
      if (q <= 0 || !warehouseId || !toWarehouseId || warehouseId === toWarehouseId) {
        return toast.error("Pick two different warehouses and a positive quantity.");
      }
      transfer.mutate({ productId, fromWarehouseId: warehouseId, toWarehouseId, quantity: q, note: note.trim() || undefined });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
      <DialogTrigger asChild>
        <Button variant="outline">{title}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <ProductField
            productId={productId}
            productLabel={productLabel}
            onSelect={(item) => {
              setProductId(item?.id ?? null);
              setProductLabel(item?.label);
            }}
          />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mv-wh">{kind === "transfer" ? "From warehouse" : "Warehouse"}</Label>
            <WarehouseSelect id="mv-wh" value={warehouseId} onChange={setWarehouseId} />
          </div>
          {kind === "transfer" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="mv-wh2">To warehouse</Label>
              <WarehouseSelect id="mv-wh2" value={toWarehouseId} onChange={setToWarehouseId} />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mv-qty">{kind === "adjust" ? "Counted on hand" : "Quantity"}</Label>
            <Input id="mv-qty" type="number" min="0" step="0.001" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mv-note">{kind === "adjust" ? "Reason" : "Note"}</Label>
            <Input id="mv-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={submit}>
            {title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function InventoryView({ canManage }: { canManage: boolean }) {
  const utils = trpc.useUtils();
  const [lowOnly, setLowOnly] = useState(false);
  const levels = trpc.inventory.levels.useQuery({ lowStockOnly: lowOnly || undefined });
  const movements = trpc.inventory.movements.useQuery({ limit: 15 });

  const refresh = () => {
    utils.inventory.levels.invalidate();
    utils.inventory.movements.invalidate();
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Inventory"
        description="On-hand and reserved stock across your warehouses, and the ledger behind it."
        action={
          canManage ? (
            <div className="flex gap-2">
              <MovementDialog kind="receive" onDone={refresh} />
              <MovementDialog kind="adjust" onDone={refresh} />
              <MovementDialog kind="transfer" onDone={refresh} />
            </div>
          ) : undefined
        }
      />

      <label className="flex w-fit items-center gap-2 text-sm text-foreground">
        <Checkbox checked={lowOnly} onCheckedChange={(c) => setLowOnly(c === true)} />
        Only show items at or below their reorder point
      </label>

      {levels.isLoading && <Skeleton className="h-40 w-full" />}
      {levels.isError && <QueryError message="Couldn't load stock levels." onRetry={() => levels.refetch()} />}

      {levels.data?.length === 0 && (
        <EmptyState
          icon={Boxes}
          title={lowOnly ? "Nothing running low" : "No stock recorded"}
          description={lowOnly ? "Every stocked item is above its reorder point." : "Receive stock into a warehouse to see it here."}
        />
      )}

      {levels.data && levels.data.length > 0 && (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead className="text-right">On hand</TableHead>
                <TableHead className="text-right">Reserved</TableHead>
                <TableHead className="text-right">Available</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {levels.data.map((row) => (
                <TableRow key={`${row.productId}-${row.warehouseId}`}>
                  <TableCell className="font-medium text-foreground">
                    {row.productName}
                    {row.lowStock && <StatusBadge status="low_stock" className="ml-2 align-middle" />}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{row.warehouseName}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{Number(row.quantityOnHand)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                    {Number(row.quantityReserved)}
                  </TableCell>
                  <TableCell className="text-right font-mono font-medium tabular-nums">
                    {Number(row.quantityAvailable)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {movements.data && movements.data.length > 0 && (
        <section className="flex flex-col gap-3 border-t pt-6">
          <h2 className="font-heading text-sm font-semibold text-foreground">Recent movements</h2>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.data.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="text-muted-foreground">{new Date(m.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>{m.productName}</TableCell>
                    <TableCell className="text-muted-foreground">{m.warehouseName}</TableCell>
                    <TableCell className="text-muted-foreground">{m.reason.replace(/_/g, " ")}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {Number(m.quantityDelta) > 0 ? "+" : ""}
                      {Number(m.quantityDelta)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}
    </div>
  );
}
