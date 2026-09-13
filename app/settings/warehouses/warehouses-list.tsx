"use client";

import { useState } from "react";
import { Star, Warehouse as WarehouseIcon } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog";
import { EditDialog } from "@/components/edit-dialog";
import { EmptyState } from "@/components/empty-state";
import { FieldError } from "@/components/field-error";
import { QueryError } from "@/components/query-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

type Warehouse = { id: string; name: string; code: string; isDefault: boolean };

export function WarehousesList() {
  const utils = trpc.useUtils();
  const query = trpc.warehouse.list.useQuery();

  const invalidate = () => utils.warehouse.list.invalidate();
  const create = trpc.warehouse.create.useMutation({
    onSuccess: () => {
      invalidate();
      setName("");
      setCode("");
      toast.success("Warehouse added");
    },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.warehouse.update.useMutation({
    onSuccess: () => {
      invalidate();
      setEditingId(null);
      toast.success("Warehouse updated");
    },
    onError: (e) => toast.error(e.message),
  });
  const setDefault = trpc.warehouse.setDefault.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("Default warehouse changed");
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.warehouse.delete.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success("Warehouse removed");
    },
    onError: (e) => toast.error(e.message),
  });

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || !code.trim()) {
            setFormError("Enter a name and a short code.");
            return;
          }
          setFormError(null);
          create.mutate({ name: name.trim(), code: code.trim() });
        }}
      >
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="wh-name">Name</Label>
          <Input id="wh-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex w-28 flex-col gap-1.5">
          <Label htmlFor="wh-code">Code</Label>
          <Input id="wh-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="MAD" />
        </div>
        <Button type="submit" disabled={create.isPending}>
          Add warehouse
        </Button>
      </form>
      <FieldError message={formError} />

      {query.isLoading && <Skeleton className="h-24 w-full" />}
      {query.isError && <QueryError message="Couldn't load your warehouses." onRetry={() => query.refetch()} />}

      {query.data?.length === 0 && (
        <EmptyState
          icon={WarehouseIcon}
          title="No warehouses yet"
          description="Add your first location. Orders reserve and ship stock from a warehouse."
        />
      )}

      {query.data && query.data.length > 0 && (
        <ul className="flex flex-col divide-y rounded-md border">
          {query.data.map((warehouse: Warehouse) => (
            <li key={warehouse.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
              <div className="flex items-center gap-2">
                <span className="font-medium text-foreground">{warehouse.name}</span>
                <span className="text-muted-foreground">{warehouse.code}</span>
                {warehouse.isDefault && (
                  <Badge variant="outline" className="border-transparent bg-secondary text-secondary-foreground">
                    Default
                  </Badge>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {!warehouse.isDefault && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={setDefault.isPending}
                    onClick={() => setDefault.mutate({ id: warehouse.id })}
                  >
                    <Star data-icon="inline-start" />
                    Make default
                  </Button>
                )}
                <EditDialog
                  trigger={
                    <Button type="button" variant="ghost" size="sm">
                      Edit
                    </Button>
                  }
                  title="Edit warehouse"
                  open={editingId === warehouse.id}
                  onOpenChange={(open) => {
                    setEditingId(open ? warehouse.id : null);
                    if (open) {
                      setEditName(warehouse.name);
                      setEditCode(warehouse.code);
                    }
                  }}
                  pending={update.isPending}
                  onSubmit={() => update.mutate({ id: warehouse.id, name: editName.trim(), code: editCode.trim() })}
                >
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`edit-wh-name-${warehouse.id}`}>Name</Label>
                    <Input
                      id={`edit-wh-name-${warehouse.id}`}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`edit-wh-code-${warehouse.id}`}>Code</Label>
                    <Input
                      id={`edit-wh-code-${warehouse.id}`}
                      value={editCode}
                      onChange={(e) => setEditCode(e.target.value)}
                    />
                  </div>
                </EditDialog>
                {!warehouse.isDefault && (
                  <DeleteConfirmDialog
                    trigger={
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                      >
                        Remove
                      </Button>
                    }
                    title={`Remove "${warehouse.name}"?`}
                    description="Stock history stays intact. You can't remove the default warehouse."
                    pending={remove.isPending}
                    onConfirm={() => remove.mutate({ id: warehouse.id })}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
