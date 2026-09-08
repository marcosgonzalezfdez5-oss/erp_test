"use client";

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  debounceMs = 300,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  debounceMs?: number;
}) {
  const [draft, setDraft] = useState(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => setDraft(value), [value]);

  useEffect(() => {
    const timeout = setTimeout(() => onChangeRef.current(draft), debounceMs);
    return () => clearTimeout(timeout);
  }, [draft, debounceMs]);

  return (
    <div className="relative w-full max-w-xs">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pl-8"
      />
    </div>
  );
}
