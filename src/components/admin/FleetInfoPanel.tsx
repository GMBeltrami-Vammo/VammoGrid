'use client';

import { useState, useTransition } from 'react';
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
import { useFleetInfo } from '@/hooks/useFleetInfo';
import { fmtDate } from '@/lib/planning/format';
import { cn } from '@/lib/utils';
import type { FleetInfo } from '@/types';
import {
  upsertFleetInfo,
  deleteFleetInfo,
  type FleetInfoInput,
} from '@/app/dashboard/admin/actions';

interface Draft {
  segment: string;
  currentSize: number;
  growthPct: number; // shown as %/month, stored as fraction
  asOfDate: string;
}

const emptyDraft = (): Draft => ({
  segment: 'total',
  currentSize: 0,
  growthPct: 0,
  asOfDate: new Date().toISOString().slice(0, 10),
});

const fromRow = (f: FleetInfo): Draft => ({
  segment: f.segment,
  currentSize: f.currentSize,
  growthPct: Math.round(f.monthlyGrowthRate * 1000) / 10,
  asOfDate: f.asOfDate ?? '',
});

export function FleetInfoPanel() {
  const { data: session } = useSession();
  const isHead = session?.user?.isHead ?? false;
  const { data: rows, isLoading, isError } = useFleetInfo();
  const queryClient = useQueryClient();

  const [creating, setCreating] = useState(false);
  const [editingSegment, setEditingSegment] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['fleet-info'] });

  const cancel = () => {
    setCreating(false);
    setEditingSegment(null);
    setError(null);
  };

  const save = () => {
    setError(null);
    const input: FleetInfoInput = {
      segment: draft.segment,
      currentSize: draft.currentSize,
      monthlyGrowthRate: draft.growthPct / 100,
      asOfDate: draft.asOfDate || null,
    };
    startTransition(async () => {
      try {
        await upsertFleetInfo(input);
        cancel();
        refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao salvar.');
      }
    });
  };

  const remove = (segment: string) => {
    if (!window.confirm(`Remover segmento "${segment}"?`)) return;
    startTransition(async () => {
      try {
        await deleteFleetInfo(segment);
        refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao remover.');
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Tamanho atual da frota e taxa de crescimento mensal. Segmento{' '}
          <span className="font-mono">total</span> = frota inteira.
        </p>
        {isHead && !creating && editingSegment == null && (
          <Button
            size="sm"
            onClick={() => {
              setDraft(emptyDraft());
              setCreating(true);
            }}
          >
            <Plus /> Segmento
          </Button>
        )}
      </div>

      {error && (
        <p className="rounded-md bg-alert-error/10 px-3 py-2 text-sm text-alert-error">
          {error}
        </p>
      )}

      {(creating || editingSegment) && (
        <FleetEditor
          draft={draft}
          setDraft={setDraft}
          onSave={save}
          onCancel={cancel}
          pending={pending}
          lockSegment={!!editingSegment}
        />
      )}

      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : isError ? (
        <p className="text-sm text-alert-error">Erro ao carregar dados da frota.</p>
      ) : rows && rows.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Segmento</TableHead>
              <TableHead className="text-right">Frota atual</TableHead>
              <TableHead className="text-right">Crescimento/mês</TableHead>
              <TableHead>Atualizado</TableHead>
              {isHead && <TableHead className="text-right">Ações</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((f) => (
              <TableRow key={f.segment}>
                <TableCell className="font-medium">{f.segment}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {f.currentSize.toLocaleString('pt-BR')}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {(f.monthlyGrowthRate * 100).toFixed(1)}%
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {fmtDate(f.asOfDate ?? f.updatedAt ?? null)}
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
                          setEditingSegment(f.segment);
                          setDraft(fromRow(f));
                        }}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Remover"
                        disabled={pending}
                        onClick={() => remove(f.segment)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nenhum dado de frota.{' '}
          {isHead ? 'Adicione o segmento "total" acima.' : ''}
        </p>
      )}
    </div>
  );
}

function FleetEditor({
  draft,
  setDraft,
  onSave,
  onCancel,
  pending,
  lockSegment,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  pending: boolean;
  lockSegment: boolean;
}) {
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft({ ...draft, [key]: value });

  return (
    <div className="rounded-lg border border-brand-500/30 bg-brand-500/[0.03] p-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Labeled label="Segmento">
          <Input
            value={draft.segment}
            disabled={lockSegment}
            onChange={(e) => set('segment', e.target.value)}
            placeholder="total"
          />
        </Labeled>
        <Labeled label="Frota atual">
          <Input
            type="number"
            min={0}
            value={draft.currentSize}
            onChange={(e) => set('currentSize', Number(e.target.value))}
          />
        </Labeled>
        <Labeled label="Crescimento/mês (%)">
          <Input
            type="number"
            step="0.1"
            value={draft.growthPct}
            onChange={(e) => set('growthPct', Number(e.target.value))}
          />
        </Labeled>
        <Labeled label="Data de referência">
          <Input
            type="date"
            value={draft.asOfDate}
            onChange={(e) => set('asOfDate', e.target.value)}
          />
        </Labeled>
      </div>
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

function Labeled({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block space-y-1', className)}>
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
