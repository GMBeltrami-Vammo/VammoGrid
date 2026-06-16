'use client';

import { useMemo, useState, useTransition } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useSkuParams } from '@/hooks/useSkuParams';
import { useInventory } from '@/hooks/useInventory';
import { cn } from '@/lib/utils';
import type { SkuParams } from '@/types';
import {
  upsertSkuParams,
  deleteSkuParams,
  type SkuParamsInput,
} from '@/app/dashboard/admin/actions';

interface Draft {
  sku: string;
  recoveryPct: number; // shown as %, stored as fraction
  recoveryLookbackDays: number;
  leadTimeDays: number | null;
}

const emptyDraft = (): Draft => ({
  sku: '',
  recoveryPct: 0,
  recoveryLookbackDays: 0,
  leadTimeDays: null,
});

const fromRow = (p: SkuParams): Draft => ({
  sku: p.sku,
  recoveryPct: Math.round(p.recoveryRate * 1000) / 10,
  recoveryLookbackDays: p.recoveryLookbackDays,
  leadTimeDays: p.leadTimeDays,
});

export function RecoveryParamsPanel() {
  const { data: session } = useSession();
  const isHead = session?.user?.isHead ?? false;
  const { data: rows, isLoading, isError } = useSkuParams();
  const { data: inventory } = useInventory();
  const queryClient = useQueryClient();

  const [creating, setCreating] = useState(false);
  const [editingSku, setEditingSku] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // SKU code → { name, avgDailyConsumption } from live inventory.
  const skuMeta = useMemo(() => {
    const m = new Map<string, { name: string; daily: number }>();
    for (const item of inventory ?? []) {
      const cur = m.get(item.skuId);
      if (cur) cur.daily += item.dailyConsumption;
      else m.set(item.skuId, { name: item.skuName, daily: item.dailyConsumption });
    }
    return m;
  }, [inventory]);

  const skuOptions = useMemo(() => [...skuMeta.keys()].sort(), [skuMeta]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['sku-params'] });

  const cancel = () => {
    setCreating(false);
    setEditingSku(null);
    setError(null);
  };

  const save = () => {
    setError(null);
    if (!draft.sku.trim()) {
      setError('SKU é obrigatório.');
      return;
    }
    const input: SkuParamsInput = {
      sku: draft.sku,
      recoveryRate: draft.recoveryPct / 100,
      recoveryLookbackDays: draft.recoveryLookbackDays,
      leadTimeDays: draft.leadTimeDays,
    };
    startTransition(async () => {
      try {
        await upsertSkuParams(input);
        cancel();
        refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao salvar.');
      }
    });
  };

  const remove = (sku: string) => {
    if (!window.confirm(`Remover parâmetros de ${sku}?`)) return;
    startTransition(async () => {
      try {
        await deleteSkuParams(sku);
        refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao remover.');
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Recuperação:</span>{' '}
        <code>recuperação = taxa × consumo(N dias antes)</code>. Modelada como
        entrada diária em Osasco de{' '}
        <code>taxa × consumo&nbsp;diário</code>, iniciando após{' '}
        <code>N</code> dias (giro de reparo). Alimenta a projeção de estoque.
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {rows ? `${rows.length} SKUs com parâmetros` : '—'}
        </p>
        {isHead && !creating && editingSku == null && (
          <Button
            size="sm"
            onClick={() => {
              setDraft(emptyDraft());
              setCreating(true);
            }}
          >
            <Plus /> Parâmetros de SKU
          </Button>
        )}
      </div>

      {error && (
        <p className="rounded-md bg-alert-error/10 px-3 py-2 text-sm text-alert-error">
          {error}
        </p>
      )}

      {(creating || editingSku) && (
        <RecoveryEditor
          draft={draft}
          setDraft={setDraft}
          onSave={save}
          onCancel={cancel}
          pending={pending}
          lockSku={!!editingSku}
          skuOptions={skuOptions}
          skuMeta={skuMeta}
        />
      )}

      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : isError ? (
        <p className="text-sm text-alert-error">Erro ao carregar parâmetros.</p>
      ) : rows && rows.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>SKU</TableHead>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Taxa recup.</TableHead>
              <TableHead className="text-right">N (dias)</TableHead>
              <TableHead className="text-right">Lead time</TableHead>
              <TableHead className="text-right">Recup./dia (est.)</TableHead>
              {isHead && <TableHead className="text-right">Ações</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => {
              const meta = skuMeta.get(p.sku);
              const daily = meta?.daily ?? 0;
              const estPerDay = p.recoveryRate * daily;
              return (
                <TableRow key={p.sku}>
                  <TableCell className="font-mono text-xs">{p.sku}</TableCell>
                  <TableCell className="max-w-[200px] truncate text-muted-foreground">
                    {meta?.name ?? '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {(p.recoveryRate * 100).toFixed(0)}%
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.recoveryLookbackDays}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.leadTimeDays ?? '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {estPerDay > 0 ? estPerDay.toFixed(1) : '—'}
                  </TableCell>
                  {isHead && (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Editar"
                          onClick={() => {
                            setCreating(false);
                            setEditingSku(p.sku);
                            setDraft(fromRow(p));
                          }}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Remover"
                          disabled={pending}
                          onClick={() => remove(p.sku)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nenhum SKU com parâmetros de recuperação ainda.
        </p>
      )}
    </div>
  );
}

function RecoveryEditor({
  draft,
  setDraft,
  onSave,
  onCancel,
  pending,
  lockSku,
  skuOptions,
  skuMeta,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  pending: boolean;
  lockSku: boolean;
  skuOptions: string[];
  skuMeta: Map<string, { name: string; daily: number }>;
}) {
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft({ ...draft, [key]: value });

  const daily = skuMeta.get(draft.sku)?.daily ?? 0;
  const estPerDay = (draft.recoveryPct / 100) * daily;

  return (
    <div className="rounded-lg border border-brand-500/30 bg-brand-500/[0.03] p-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Labeled label="SKU *">
          <Input
            value={draft.sku}
            disabled={lockSku}
            list="recovery-sku-options"
            onChange={(e) => set('sku', e.target.value)}
            placeholder="VM-01-FRE0-1010"
          />
          <datalist id="recovery-sku-options">
            {skuOptions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Labeled>
        <Labeled label="Taxa de recuperação (%)">
          <Input
            type="number"
            step="1"
            min={0}
            value={draft.recoveryPct}
            onChange={(e) => set('recoveryPct', Number(e.target.value))}
          />
        </Labeled>
        <Labeled label="N — dias antes">
          <Input
            type="number"
            min={0}
            value={draft.recoveryLookbackDays}
            onChange={(e) => set('recoveryLookbackDays', Number(e.target.value))}
          />
        </Labeled>
        <Labeled label="Lead time (dias)">
          <Input
            type="number"
            min={0}
            value={draft.leadTimeDays ?? ''}
            onChange={(e) =>
              set('leadTimeDays', e.target.value === '' ? null : Number(e.target.value))
            }
          />
        </Labeled>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Consumo diário atual deste SKU:{' '}
        <span className="font-medium text-foreground">{daily.toFixed(1)} un/dia</span>
        {' · '}recuperação estimada:{' '}
        <span className="font-medium text-foreground">
          {estPerDay.toFixed(1)} un/dia
        </span>
      </p>
      <div className="mt-4 flex gap-2">
        <Button size="sm" onClick={onSave} disabled={pending}>
          <Check /> {pending ? 'Salvando…' : 'Salvar'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
          <X /> Cancelar
        </Button>
      </div>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className={cn('block space-y-1')}>
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
