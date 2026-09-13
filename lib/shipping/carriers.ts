/**
 * Carrier list + tracking-URL templates. Deliberately *not* an integration —
 * v1 shipping is manual carrier + tracking-number entry (CLAUDE.md §17: no
 * integrations framework before 2–3 real needs). Rate shopping, label
 * purchase and tracking webhooks are explicitly V3+.
 */
export const CARRIERS = ["ups", "fedex", "dhl", "gls", "seur", "correos", "mrw", "nacex", "other"] as const;

export type Carrier = (typeof CARRIERS)[number];

const TRACKING_URL_TEMPLATES: Partial<Record<Carrier, string>> = {
  ups: "https://www.ups.com/track?loc=en_US&tracknum={tracking}",
  fedex: "https://www.fedex.com/fedextrack/?trknbr={tracking}",
  dhl: "https://www.dhl.com/global-en/home/tracking.html?tracking-id={tracking}",
  gls: "https://gls-group.com/track?match={tracking}",
  seur: "https://www.seur.com/livetracking/?segOnlineIdentificador={tracking}",
  correos: "https://www.correos.es/es/es/herramientas/localizador/envios/detalle?tracking-number={tracking}",
  mrw: "https://www.mrw.es/seguimiento_envios/MRW_seguimiento_envios.asp?enviament={tracking}",
  nacex: "https://www.nacex.es/seguimientoDetalle.do?agencia_origen=&numero_albaran={tracking}",
};

/** The public tracking page for a shipment, or null when it can't be derived. */
export function trackingUrlFor(carrier: Carrier, trackingNumber: string | null | undefined): string | null {
  if (!trackingNumber) return null;
  const template = TRACKING_URL_TEMPLATES[carrier];
  return template ? template.replace("{tracking}", encodeURIComponent(trackingNumber)) : null;
}
