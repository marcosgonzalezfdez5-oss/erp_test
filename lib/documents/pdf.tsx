import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

/**
 * Server-side PDF rendering for the legally-significant documents — invoice,
 * credit note (factura rectificativa) and delivery note (albarán). One
 * normalized `DocumentPdfModel` drives all three; `lib/documents/data.ts`
 * assembles it from tenant-scoped service reads. Rendered from the route
 * handler `app/api/documents/[type]/[id]/pdf/route.ts` and reused as the
 * email attachment (`emailService.sendDocument`).
 */

export interface PartyView {
  name: string;
  taxId: string | null;
  addressLines: string[];
}

export interface DocumentPdfModel {
  kind: "invoice" | "credit_note" | "delivery_note";
  title: string;
  number: string;
  date: string;
  seller: PartyView;
  buyer: PartyView;
  buyerLabel: string;
  meta: Array<{ label: string; value: string }>;
  /** Money columns are omitted for a delivery note. */
  showAmounts: boolean;
  lines: Array<{
    description: string;
    quantity: string;
    unit: string;
    unitPrice?: string;
    discount?: string;
    amount?: string;
  }>;
  taxGroups: Array<{ base: string; rate: string; tax: string; note?: string }>;
  totals: Array<{ label: string; value: string; strong?: boolean }>;
  legalNotes: string[];
  notes: string | null;
}

const s = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 56, paddingHorizontal: 44, fontSize: 9, fontFamily: "Helvetica", color: "#1a1a1a", lineHeight: 1.4 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 },
  docTitle: { fontSize: 18, fontFamily: "Helvetica-Bold" },
  docNumber: { fontSize: 10, marginTop: 2, color: "#555" },
  partyRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 20 },
  partyBox: { width: "48%" },
  partyLabel: { fontSize: 7, textTransform: "uppercase", letterSpacing: 1, color: "#888", marginBottom: 3 },
  partyName: { fontFamily: "Helvetica-Bold" },
  metaBox: { marginBottom: 16, flexDirection: "row", flexWrap: "wrap" },
  metaItem: { width: "33%", marginBottom: 4 },
  metaLabel: { fontSize: 7, textTransform: "uppercase", letterSpacing: 1, color: "#888" },
  th: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#1a1a1a", paddingBottom: 4, fontFamily: "Helvetica-Bold", fontSize: 8 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#ddd", paddingVertical: 4 },
  cDesc: { flex: 1, paddingRight: 6 },
  cNum: { width: 70, textAlign: "right" },
  cQty: { width: 60, textAlign: "right" },
  totalsWrap: { marginTop: 14, alignItems: "flex-end" },
  totalRow: { flexDirection: "row", width: 220, justifyContent: "space-between", paddingVertical: 2 },
  totalStrong: { fontFamily: "Helvetica-Bold", fontSize: 11, borderTopWidth: 1, borderTopColor: "#1a1a1a", marginTop: 3, paddingTop: 4 },
  taxTable: { marginTop: 14, width: 320 },
  section: { marginTop: 16 },
  sectionLabel: { fontSize: 7, textTransform: "uppercase", letterSpacing: 1, color: "#888", marginBottom: 3 },
  legal: { marginTop: 4, fontSize: 8, color: "#555" },
  footer: { position: "absolute", bottom: 28, left: 44, right: 44, fontSize: 7, color: "#999", textAlign: "center", borderTopWidth: 0.5, borderTopColor: "#ddd", paddingTop: 6 },
});

function Party({ label, party }: { label: string; party: PartyView }) {
  return (
    <View style={s.partyBox}>
      <Text style={s.partyLabel}>{label}</Text>
      <Text style={s.partyName}>{party.name}</Text>
      {party.taxId ? <Text>NIF: {party.taxId}</Text> : null}
      {party.addressLines.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
    </View>
  );
}

function DocumentPdf({ model }: { model: DocumentPdfModel }) {
  return (
    <Document title={`${model.title} ${model.number}`}>
      <Page size="A4" style={s.page}>
        <View style={s.headerRow}>
          <View>
            <Text style={s.docTitle}>{model.title}</Text>
            <Text style={s.docNumber}>
              {model.number} · {model.date}
            </Text>
          </View>
        </View>

        <View style={s.partyRow}>
          <Party label="Emisor" party={model.seller} />
          <Party label={model.buyerLabel} party={model.buyer} />
        </View>

        {model.meta.length > 0 ? (
          <View style={s.metaBox}>
            {model.meta.map((m, i) => (
              <View key={i} style={s.metaItem}>
                <Text style={s.metaLabel}>{m.label}</Text>
                <Text>{m.value}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <View style={s.th}>
          <Text style={s.cDesc}>Descripción</Text>
          <Text style={s.cQty}>Cant.</Text>
          {model.showAmounts ? (
            <>
              <Text style={s.cNum}>Precio</Text>
              <Text style={s.cNum}>Dto.</Text>
              <Text style={s.cNum}>Importe</Text>
            </>
          ) : null}
        </View>
        {model.lines.map((line, i) => (
          <View key={i} style={s.tr} wrap={false}>
            <Text style={s.cDesc}>{line.description}</Text>
            <Text style={s.cQty}>
              {line.quantity} {line.unit}
            </Text>
            {model.showAmounts ? (
              <>
                <Text style={s.cNum}>{line.unitPrice ?? ""}</Text>
                <Text style={s.cNum}>{line.discount ?? ""}</Text>
                <Text style={s.cNum}>{line.amount ?? ""}</Text>
              </>
            ) : null}
          </View>
        ))}

        {model.showAmounts && model.taxGroups.length > 0 ? (
          <View style={s.taxTable}>
            <View style={s.th}>
              <Text style={s.cDesc}>Base imponible</Text>
              <Text style={s.cNum}>Tipo</Text>
              <Text style={s.cNum}>Cuota</Text>
            </View>
            {model.taxGroups.map((g, i) => (
              <View key={i} style={s.tr}>
                <Text style={s.cDesc}>
                  {g.base}
                  {g.note ? ` · ${g.note}` : ""}
                </Text>
                <Text style={s.cNum}>{g.rate}</Text>
                <Text style={s.cNum}>{g.tax}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {model.showAmounts && model.totals.length > 0 ? (
          <View style={s.totalsWrap}>
            {model.totals.map((t, i) => (
              <View key={i} style={[s.totalRow, ...(t.strong ? [s.totalStrong] : [])]}>
                <Text>{t.label}</Text>
                <Text>{t.value}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {model.legalNotes.length > 0 ? (
          <View style={s.section}>
            {model.legalNotes.map((note, i) => (
              <Text key={i} style={s.legal}>
                {note}
              </Text>
            ))}
          </View>
        ) : null}

        {model.notes ? (
          <View style={s.section}>
            <Text style={s.sectionLabel}>Observaciones</Text>
            <Text>{model.notes}</Text>
          </View>
        ) : null}

        <Text style={s.footer} fixed>
          {model.seller.name}
          {model.seller.taxId ? ` · NIF ${model.seller.taxId}` : ""} · {model.title} {model.number}
        </Text>
      </Page>
    </Document>
  );
}

export function renderDocumentPdf(model: DocumentPdfModel): Promise<Buffer> {
  return renderToBuffer(<DocumentPdf model={model} />);
}
