import { TRPCError } from "@trpc/server";
import { deliveryNoteModel, invoiceDocumentModel, type DocumentType } from "@/lib/documents/data";
import { renderDocumentPdf } from "@/lib/documents/pdf";
import { resolveSessionContext } from "@/lib/auth/session";

export const runtime = "nodejs";

const TYPES: DocumentType[] = ["invoice", "credit-note", "delivery-note"];

/**
 * Renders a legally-significant document (invoice, credit note, delivery note)
 * as a PDF. A sanctioned non-CRUD route handler (CLAUDE.md §13): it resolves
 * the session server-side and every model builder is tenant-scoped, so a
 * cross-tenant id resolves to a 404.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ type: string; id: string }> },
): Promise<Response> {
  const session = await resolveSessionContext();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { type, id } = await params;
  if (!TYPES.includes(type as DocumentType)) {
    return new Response("Unknown document type", { status: 404 });
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const model =
      type === "delivery-note"
        ? await deliveryNoteModel(session.tenantId, id)
        : await invoiceDocumentModel(session.tenantId, id, type as "invoice" | "credit-note");
    const pdf = await renderDocumentPdf(model);

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${model.number.replace(/[^\w.-]+/g, "-")}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof TRPCError && err.code === "NOT_FOUND") {
      return new Response("Not found", { status: 404 });
    }
    throw err;
  }
}
