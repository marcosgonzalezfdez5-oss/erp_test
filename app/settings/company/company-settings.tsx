"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { RouterOutputs } from "@/lib/trpc/client";
import { trpc } from "@/lib/trpc/client";
import { FieldError } from "@/components/field-error";
import { QueryError } from "@/components/query-error";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

type Settings = RouterOutputs["tenantSettings"]["get"];

type FormState = {
  legalName: string;
  taxId: string;
  line1: string;
  line2: string;
  city: string;
  postalCode: string;
  province: string;
  country: string;
  defaultCurrency: string;
  defaultTaxRatePercent: string;
  irpfEnabled: boolean;
  irpfRatePercent: string;
  defaultPaymentTermsDays: string;
  orderNumberFormat: string;
  deliveryNoteNumberFormat: string;
  invoiceNumberFormat: string;
  creditNoteNumberFormat: string;
  allowNegativeStock: boolean;
};

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-x-8 gap-y-4 border-b py-6 first:pt-0 last:border-b-0 md:grid-cols-[14rem_1fr]">
      <div>
        <h2 className="font-heading text-sm font-semibold text-foreground">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function initialForm(s: Settings): FormState {
  return {
    legalName: s.legalName ?? "",
    taxId: s.taxId ?? "",
    line1: s.legalAddress?.line1 ?? "",
    line2: s.legalAddress?.line2 ?? "",
    city: s.legalAddress?.city ?? "",
    postalCode: s.legalAddress?.postalCode ?? "",
    province: s.legalAddress?.province ?? "",
    country: s.legalAddress?.country ?? "ES",
    defaultCurrency: s.defaultCurrency,
    defaultTaxRatePercent: s.defaultTaxRatePercent,
    irpfEnabled: s.irpfEnabled,
    irpfRatePercent: s.irpfRatePercent,
    defaultPaymentTermsDays: String(s.defaultPaymentTermsDays),
    orderNumberFormat: s.orderNumberFormat,
    deliveryNoteNumberFormat: s.deliveryNoteNumberFormat,
    invoiceNumberFormat: s.invoiceNumberFormat,
    creditNoteNumberFormat: s.creditNoteNumberFormat,
    allowNegativeStock: s.allowNegativeStock,
  };
}

export function CompanySettings() {
  const query = trpc.tenantSettings.get.useQuery();

  if (query.isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }
  if (query.isError || !query.data) {
    return <QueryError message="Couldn't load your company settings." onRetry={() => query.refetch()} />;
  }
  // Key on the saved values so a successful save re-seeds the form cleanly.
  return <CompanyForm key={JSON.stringify(query.data)} initial={query.data} />;
}

function CompanyForm({ initial }: { initial: Settings }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<FormState>(() => initialForm(initial));
  const [error, setError] = useState<string | null>(null);

  const save = trpc.tenantSettings.update.useMutation({
    onSuccess: () => {
      utils.tenantSettings.get.invalidate();
      toast.success("Company settings saved");
    },
    onError: (e) => {
      setError(e.message);
      toast.error(e.message);
    },
  });

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setError(null);
  };

  const hasAnyAddress = form.line1 || form.city || form.postalCode;

  function submit() {
    const rate = Number(form.defaultTaxRatePercent);
    const irpf = Number(form.irpfRatePercent);
    const terms = Number(form.defaultPaymentTermsDays);
    if (Number.isNaN(rate) || Number.isNaN(irpf) || Number.isNaN(terms)) {
      setError("Tax rate, IRPF rate, and payment terms must be numbers.");
      return;
    }
    if (hasAnyAddress && (!form.line1.trim() || !form.city.trim() || !form.postalCode.trim())) {
      setError("An address needs at least a street, city, and postal code.");
      return;
    }
    save.mutate({
      legalName: form.legalName.trim() || null,
      taxId: form.taxId.trim() || null,
      legalAddress: hasAnyAddress
        ? {
            line1: form.line1.trim(),
            line2: form.line2.trim() || undefined,
            city: form.city.trim(),
            postalCode: form.postalCode.trim(),
            province: form.province.trim() || undefined,
            country: form.country.trim().toUpperCase(),
          }
        : null,
      defaultCurrency: form.defaultCurrency.trim().toUpperCase(),
      defaultTaxRatePercent: rate,
      irpfEnabled: form.irpfEnabled,
      irpfRatePercent: irpf,
      defaultPaymentTermsDays: terms,
      orderNumberFormat: form.orderNumberFormat.trim(),
      deliveryNoteNumberFormat: form.deliveryNoteNumberFormat.trim(),
      invoiceNumberFormat: form.invoiceNumberFormat.trim(),
      creditNoteNumberFormat: form.creditNoteNumberFormat.trim(),
      allowNegativeStock: form.allowNegativeStock,
    });
  }

  return (
    <form
      className="flex flex-col"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Section
        title="Legal identity"
        description="Printed on every issued invoice and credit note. An invoice can't be issued until the name and tax ID are set."
      >
        <Field id="legal-name" label="Registered name">
          <Input id="legal-name" value={form.legalName} onChange={(e) => set("legalName", e.target.value)} />
        </Field>
        <Field id="tax-id" label="Tax ID (NIF)">
          <Input id="tax-id" value={form.taxId} onChange={(e) => set("taxId", e.target.value)} />
        </Field>
        <Field id="addr-line1" label="Street">
          <Input id="addr-line1" value={form.line1} onChange={(e) => set("line1", e.target.value)} />
        </Field>
        <Field id="addr-line2" label="Street, line 2">
          <Input id="addr-line2" value={form.line2} onChange={(e) => set("line2", e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="addr-postal" label="Postal code">
            <Input id="addr-postal" value={form.postalCode} onChange={(e) => set("postalCode", e.target.value)} />
          </Field>
          <Field id="addr-city" label="City">
            <Input id="addr-city" value={form.city} onChange={(e) => set("city", e.target.value)} />
          </Field>
          <Field id="addr-province" label="Province">
            <Input id="addr-province" value={form.province} onChange={(e) => set("province", e.target.value)} />
          </Field>
          <Field id="addr-country" label="Country" hint="Two-letter code, e.g. ES.">
            <Input
              id="addr-country"
              value={form.country}
              maxLength={2}
              onChange={(e) => set("country", e.target.value.toUpperCase())}
            />
          </Field>
        </div>
      </Section>

      <Section title="Tax defaults" description="Applied to new products and lines that don't specify their own rate.">
        <div className="grid grid-cols-2 gap-3">
          <Field id="currency" label="Currency" hint="Three-letter code.">
            <Input
              id="currency"
              value={form.defaultCurrency}
              maxLength={3}
              onChange={(e) => set("defaultCurrency", e.target.value.toUpperCase())}
            />
          </Field>
          <Field id="vat-rate" label="Default VAT rate %">
            <Input
              id="vat-rate"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={form.defaultTaxRatePercent}
              onChange={(e) => set("defaultTaxRatePercent", e.target.value)}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Checkbox checked={form.irpfEnabled} onCheckedChange={(c) => set("irpfEnabled", c === true)} />
          Withhold IRPF on invoices
        </label>
        {form.irpfEnabled && (
          <Field id="irpf-rate" label="IRPF rate %">
            <Input
              id="irpf-rate"
              type="number"
              min="0"
              max="100"
              step="0.01"
              className="w-32"
              value={form.irpfRatePercent}
              onChange={(e) => set("irpfRatePercent", e.target.value)}
            />
          </Field>
        )}
      </Section>

      <Section
        title="Documents"
        description="Number formats for each series. {YYYY} and {YY} expand to the year; {SEQ:4} is a zero-padded counter."
      >
        <div className="grid grid-cols-2 gap-3">
          <Field id="fmt-order" label="Orders">
            <Input id="fmt-order" value={form.orderNumberFormat} onChange={(e) => set("orderNumberFormat", e.target.value)} />
          </Field>
          <Field id="fmt-dn" label="Delivery notes">
            <Input
              id="fmt-dn"
              value={form.deliveryNoteNumberFormat}
              onChange={(e) => set("deliveryNoteNumberFormat", e.target.value)}
            />
          </Field>
          <Field id="fmt-inv" label="Invoices">
            <Input
              id="fmt-inv"
              value={form.invoiceNumberFormat}
              onChange={(e) => set("invoiceNumberFormat", e.target.value)}
            />
          </Field>
          <Field id="fmt-rec" label="Credit notes">
            <Input
              id="fmt-rec"
              value={form.creditNoteNumberFormat}
              onChange={(e) => set("creditNoteNumberFormat", e.target.value)}
            />
          </Field>
        </div>
        <Field id="terms" label="Payment terms (days)" hint="Sets the due date when an invoice is issued.">
          <Input
            id="terms"
            type="number"
            min="0"
            max="365"
            className="w-32"
            value={form.defaultPaymentTermsDays}
            onChange={(e) => set("defaultPaymentTermsDays", e.target.value)}
          />
        </Field>
      </Section>

      <Section title="Operations" description="How stock behaves when there isn't enough on hand.">
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Checkbox
            checked={form.allowNegativeStock}
            onCheckedChange={(c) => set("allowNegativeStock", c === true)}
          />
          Allow confirming orders that exceed available stock (flags the line as backordered)
        </label>
      </Section>

      <div className="flex items-center gap-4 pt-6">
        <Button type="submit" disabled={save.isPending}>
          Save changes
        </Button>
        <FieldError message={error} />
      </div>
    </form>
  );
}
