/**
 * A snapshotted postal address stored as JSONB. There is no table — this is a
 * shared column shape reused by tenant settings, warehouses, and (later)
 * orders / shipments / invoices, which each freeze the address at the moment a
 * document is committed rather than joining it live.
 */
export interface PostalAddress {
  line1: string;
  line2?: string;
  city: string;
  postalCode: string;
  /** Province / state / region. */
  province?: string;
  /** ISO 3166-1 alpha-2 country code, e.g. "ES". */
  country: string;
}
