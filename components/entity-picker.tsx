"use client";

import { useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface PickerItem {
  id: string;
  label: string;
  hint?: string;
}

/**
 * A search-and-pick control for choosing one record (account, product, …) when
 * the full list is too long for a plain <select>. The parent owns the query —
 * it passes the current result page in `items` and reacts to `onSearchChange`.
 */
export function EntityPicker({
  value,
  selectedLabel,
  items,
  onSearchChange,
  onSelect,
  placeholder = "Search…",
  emptyText = "Nothing found.",
}: {
  value: string | null;
  selectedLabel?: string;
  items: PickerItem[];
  onSearchChange: (search: string) => void;
  onSelect: (item: PickerItem | null) => void;
  placeholder?: string;
  emptyText?: string;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleSearch(next: string) {
    setSearch(next);
    setOpen(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => onSearchChange(next), 250);
  }

  if (value && selectedLabel) {
    return (
      <div className="flex items-center justify-between rounded-lg border px-3 py-1.5 text-sm">
        <span className="text-foreground">{selectedLabel}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Clear selection"
          onClick={() => {
            onSelect(null);
            setSearch("");
            setOpen(true);
          }}
        >
          <X />
        </Button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Input
        value={search}
        placeholder={placeholder}
        onChange={(e) => handleSearch(e.target.value)}
        onFocus={() => setOpen(true)}
      />
      {open && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border bg-popover p-1 shadow-md">
          {items.length === 0 && <li className="px-2 py-1.5 text-sm text-muted-foreground">{emptyText}</li>}
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onSelect(item);
                  setOpen(false);
                }}
              >
                <span className="text-foreground">{item.label}</span>
                {item.hint && <span className="shrink-0 text-xs text-muted-foreground">{item.hint}</span>}
                {value === item.id && <Check className="size-4 text-primary" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
