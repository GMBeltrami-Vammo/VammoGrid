'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FlaskConical, Ship, Plane, Truck, Package, type LucideIcon } from 'lucide-react';
import type { ModalOption } from '@/lib/planning/supplierGroups';
import { readModalCfgClient, setModalCfgEntry, writeModalCfgClient, type ModalCfg } from '@/lib/planning/modalConfig';
import { cn } from '@/lib/utils';

// The "com pedido sugerido" (yellow overlay) is server-computed by the N-modal cascade for the
// SELECTED supplier's enabled modais. This panel — the same one as Novo Pedido / Projeção Global,
// but locked to the suppliers that carry THIS SKU — drives that simulation: supplier + enabled
// modais live in the URL (?forn/?modais → server recompute), and piso/cadência/lead live in the
// shared session cookie (vg:modalcfg → refresh). All ephemeral; nothing is persisted.

interface SupplierOpt {
  supplierId: string;
  name: string;
}

/** Icon + accent for a modal by name (marítimo/aéreo/courier/other). */
function modalVisual(name: string): { Icon: LucideIcon; className: string } {
  const n = name.toLowerCase();
  if (/mar[ií]t|sea|navio|barco/.test(n)) return { Icon: Ship, className: 'text-[color:var(--color-alert-info)]' };
  if (/a[eé]re|air|avi[ãa]o/.test(n)) return { Icon: Plane, className: 'text-brand-600' };
  if (/courier|expr|moto|terrestre|rodo/.test(n)) return { Icon: Truck, className: 'text-emerald-600 dark:text-emerald-400' };
  return { Icon: Package, className: 'text-muted-foreground' };
}

export function SkuSuggestionControls({
  suppliers,
  selectedSupplierId,
  modais,
  enabledModais,
  dohThreshold,
}: {
  /** Suppliers that carry THIS SKU (the dropdown is locked to these). */
  suppliers: SupplierOpt[];
  selectedSupplierId: string;
  /** The selected supplier's modais — the toggle checkboxes + per-modal config. */
  modais: ModalOption[];
  /** Which modal names are currently enabled (checked). */
  enabledModais: string[];
  /** Global criteria DOH threshold — the piso placeholder. */
  dohThreshold: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [navPending, startNav] = useTransition();
  const [applyPending, startApply] = useTransition();

  const [cfg, setCfg] = useState<ModalCfg>({});
  useEffect(() => {
    setCfg(readModalCfgClient());
  }, []);

  // Preserve every other query param (notably ?sku=) when changing forn/modais.
  const setParams = (updates: Record<string, string | null>) => {
    const p = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    const qs = p.toString();
    startNav(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  };

  const entryFor = (name: string) => cfg[selectedSupplierId]?.[name] ?? {};
  const patchEntry = (modalName: string, patch: { piso?: number | null; cad?: number | null; lead?: number | null }) => {
    const next = setModalCfgEntry(cfg, selectedSupplierId, modalName, {
      piso: patch.piso === null ? NaN : patch.piso,
      cad: patch.cad === null ? NaN : patch.cad,
      lead: patch.lead === null ? NaN : patch.lead,
    });
    setCfg(next);
    writeModalCfgClient(next);
  };
  const commitCfg = () => startApply(() => router.refresh());
  const hasCfg = Object.values(cfg[selectedSupplierId] ?? {}).some((e) => e.piso || e.cad || e.lead);
  const clearCfg = () => {
    const next = { ...cfg };
    delete next[selectedSupplierId];
    setCfg(next);
    writeModalCfgClient(next);
    startApply(() => router.refresh());
  };

  const enabledSet = useMemo(() => new Set(enabledModais), [enabledModais]);
  const toggleModal = (name: string) => {
    const next = new Set(enabledSet);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    const ordered = modais.filter((m) => next.has(m.name)).map((m) => m.name);
    setParams({ modais: ordered.join(',') }); // "" = none → no suggestion
  };
  // Slowest ENABLED modal by sim lead — only it carries a cadência ("uma vez só" for the rest).
  const slowestName = useMemo(() => {
    const on = modais.filter((m) => enabledSet.has(m.name));
    if (on.length === 0) return '';
    const sorted = [...on].sort((a, b) => {
      const la = cfg[selectedSupplierId]?.[a.name]?.lead ?? a.leadDays;
      const lb = cfg[selectedSupplierId]?.[b.name]?.lead ?? b.leadDays;
      return la - lb;
    });
    return sorted[sorted.length - 1].name;
  }, [modais, enabledSet, cfg, selectedSupplierId]);

  const busy = navPending || applyPending;

  return (
    <div className={cn('rounded-xl bg-card ring-1 ring-foreground/10', busy && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2.5 text-sm">
        <FlaskConical size={14} className="text-muted-foreground" />
        <span className="font-medium">Pedido sugerido (simulação)</span>
        {hasCfg && <span className="rounded-full bg-brand-500/15 px-2 py-0.5 text-[10px] font-semibold text-brand-600">config ativa</span>}
        <span className="text-[11px] text-muted-foreground">
          alimenta a linha amarela “com pedido sugerido”; só simulação (nada é gravado)
        </span>
        {hasCfg && (
          <button
            onClick={clearCfg}
            disabled={applyPending}
            className="ml-auto rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted/40 disabled:opacity-50"
          >
            Limpar config
          </button>
        )}
      </div>

      {suppliers.length === 0 ? (
        <p className="px-4 py-3 text-xs text-muted-foreground">
          Nenhum fornecedor vinculado a este SKU. A sugestão usa o lead padrão do SKU (marítimo/aéreo).{' '}
          <Link href="/dashboard/fornecedores" className="underline">Vincular um fornecedor</Link> habilita a simulação por modal.
        </p>
      ) : (
        <div className="space-y-3 px-4 py-3">
          <label className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium uppercase tracking-wide text-muted-foreground/70">Fornecedor</span>
            <select
              value={selectedSupplierId}
              onChange={(e) => setParams({ forn: e.target.value, modais: null })}
              title="Fornecedor cujos modais alimentam a sugestão (só os que têm este SKU)"
              className="h-8 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-brand-500"
            >
              {suppliers.map((s) => (
                <option key={s.supplierId} value={s.supplierId}>{s.name}</option>
              ))}
            </select>
            <span className="text-[11px] text-muted-foreground">só fornecedores que têm este SKU</span>
          </label>

          <div className="space-y-1.5">
            {modais.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Este fornecedor não tem modais cadastrados.{' '}
                <Link href="/dashboard/fornecedores" className="underline">Cadastrar modais</Link>.
              </p>
            ) : (
              modais.map((m) => {
                const { Icon, className } = modalVisual(m.name);
                const on = enabledSet.has(m.name);
                const e = entryFor(m.name);
                const isSlow = slowestName === m.name;
                const numOr = (v: string) => (v.trim() === '' ? null : Number(v));
                return (
                  <div key={m.id} className={cn('flex flex-wrap items-center gap-2 text-xs', !on && 'opacity-50')}>
                    <label className="inline-flex w-40 cursor-pointer items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleModal(m.name)}
                        className="size-3.5 cursor-pointer accent-brand-500"
                      />
                      <Icon className={cn('size-3', className)} /> {m.name}
                      <span className="text-muted-foreground">+{m.leadDays}d</span>
                    </label>
                    <label className="inline-flex items-center gap-1 text-muted-foreground">
                      lead sim.
                      <input
                        type="number"
                        min={1}
                        value={e.lead ?? ''}
                        disabled={!on}
                        onChange={(ev) => patchEntry(m.name, { lead: numOr(ev.target.value) })}
                        onBlur={commitCfg}
                        placeholder={String(m.leadDays)}
                        title="Lead hipotético (dias) — só simulação; não muda a ETA de um pedido real"
                        className="h-7 w-14 rounded border border-border bg-background px-2 text-right tabular-nums outline-none focus:border-brand-500 placeholder:text-muted-foreground/40 disabled:opacity-50"
                      />
                    </label>
                    <label className="inline-flex items-center gap-1 text-muted-foreground">
                      piso
                      <input
                        type="number"
                        min={1}
                        value={e.piso ?? ''}
                        disabled={!on}
                        onChange={(ev) => patchEntry(m.name, { piso: numOr(ev.target.value) })}
                        onBlur={commitCfg}
                        placeholder={String(dohThreshold)}
                        title="Piso de cobertura (DOH mín) que este modal segura"
                        className="h-7 w-14 rounded border border-border bg-background px-2 text-right tabular-nums outline-none focus:border-brand-500 placeholder:text-muted-foreground/40 disabled:opacity-50"
                      />
                    </label>
                    {isSlow ? (
                      <label className="inline-flex items-center gap-1 text-muted-foreground">
                        cadência
                        <input
                          type="number"
                          min={1}
                          value={e.cad ?? ''}
                          disabled={!on}
                          onChange={(ev) => patchEntry(m.name, { cad: numOr(ev.target.value) })}
                          onBlur={commitCfg}
                          placeholder="30"
                          title="Periodicidade de reposição do modal mais lento"
                          className="h-7 w-14 rounded border border-border bg-background px-2 text-right tabular-nums outline-none focus:border-brand-500 placeholder:text-muted-foreground/40 disabled:opacity-50"
                        />
                      </label>
                    ) : (
                      on && <span className="text-[10px] italic text-muted-foreground/70">uma vez só</span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
