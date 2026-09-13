import { resolveSessionContext } from "@/lib/auth/session";
import * as reportService from "@/lib/services/reports";

export const runtime = "nodejs";

const MANAGER_ROLES = ["admin", "sales_manager"] as const;

/**
 * CSV export for the four reports. A sanctioned non-CRUD route handler
 * (CLAUDE.md §13) — a file download can't be a tRPC procedure. Session-resolved
 * and manager-gated, matching `reportRouter`.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ report: string }> },
): Promise<Response> {
  const session = await resolveSessionContext();
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (!MANAGER_ROLES.includes(session.role as (typeof MANAGER_ROLES)[number])) {
    return new Response("Forbidden", { status: 403 });
  }

  const { report } = await params;
  const url = new URL(req.url);
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;
  const asOf = url.searchParams.get("asOf") ?? undefined;
  const { tenantId } = session;

  let csv: string;
  let filename: string;
  switch (report) {
    case "ar-aging":
      csv = reportService.arAgingCsv(await reportService.arAging(tenantId, { asOf }));
      filename = "ar-aging";
      break;
    case "stock-valuation":
      csv = reportService.stockValuationCsv(await reportService.stockValuation(tenantId));
      filename = "stock-valuation";
      break;
    case "margin":
      csv = reportService.marginCsv(await reportService.margin(tenantId, { from, to }));
      filename = "margin";
      break;
    case "sales":
      csv = reportService.salesByTaxRateCsv(await reportService.salesByTaxRate(tenantId, { from, to }));
      filename = "sales-by-vat-rate";
      break;
    default:
      return new Response("Unknown report", { status: 404 });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}-${stamp}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
