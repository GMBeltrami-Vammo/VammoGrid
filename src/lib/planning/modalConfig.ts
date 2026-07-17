// Ephemeral, session-scoped per-modal config SHARED between Novo Pedido and Projeção Global.
// Lives in a session cookie (no Max-Age → cleared when the browser closes; never in the DB),
// so both pages read the SAME values and the Projeção Global scenarios match the Novo Pedido
// suggestion. Keyed by supplier_id → modal NAME (lanes/scenarios are identified by name across
// the two tabs). Client-safe (no server-only imports) so both a client component and a server
// page (via next/headers cookies → parseModalCfg) can use it.

export interface ModalCfgEntry {
  /** Piso de cobertura (DOH mín) que o modal segura. */
  piso?: number;
  /** Cadência de reposição (dias) — só o modal mais lento usa (os outros são "uma vez só"). */
  cad?: number;
  /** Lead hipotético (dias) — SÓ simulação: muda a sugestão/heatmap, nunca a ETA do pedido real. */
  lead?: number;
}

export type ModalCfg = Record<string, Record<string, ModalCfgEntry>>;

export const MODAL_CFG_COOKIE = 'vg:modalcfg';

export function parseModalCfg(raw: string | undefined | null): ModalCfg {
  if (!raw) return {};
  try {
    const o = JSON.parse(decodeURIComponent(raw)) as unknown;
    return o && typeof o === 'object' ? (o as ModalCfg) : {};
  } catch {
    return {};
  }
}

export function modalCfgEntry(cfg: ModalCfg, supplierId: string, modalName: string): ModalCfgEntry {
  return cfg[supplierId]?.[modalName] ?? {};
}

/** Immutably set one (supplier × modal) entry. A null/NaN value clears that field. */
export function setModalCfgEntry(
  cfg: ModalCfg,
  supplierId: string,
  modalName: string,
  patch: ModalCfgEntry,
): ModalCfg {
  const supp = { ...(cfg[supplierId] ?? {}) };
  const cur = { ...(supp[modalName] ?? {}) };
  (['piso', 'cad', 'lead'] as const).forEach((k) => {
    const v = patch[k];
    if (v === undefined) return;
    if (v == null || Number.isNaN(v) || v <= 0) delete cur[k];
    else cur[k] = Math.round(v);
  });
  supp[modalName] = cur;
  return { ...cfg, [supplierId]: supp };
}

/** Read the cookie on the client (document.cookie). Returns {} on the server. */
export function readModalCfgClient(): ModalCfg {
  if (typeof document === 'undefined') return {};
  const m = document.cookie.match(/(?:^|;\s*)vg:modalcfg=([^;]+)/);
  return parseModalCfg(m?.[1]);
}

/** Write the cookie on the client — a SESSION cookie (no Max-Age): ephemeral, per-browser,
 *  never persisted to the DB. Both tabs read it on load. */
export function writeModalCfgClient(cfg: ModalCfg): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${MODAL_CFG_COOKIE}=${encodeURIComponent(JSON.stringify(cfg))}; path=/; SameSite=Lax`;
}
