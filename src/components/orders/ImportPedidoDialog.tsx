'use client';

import { useRef, useState, useTransition } from 'react';
import { Check, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DateField } from '@/components/ui/DateField';
import { cn } from '@/lib/utils';
import { fmtInt } from '@/lib/planning/format';
import { parseImportRows, type ParsedImportLine } from '@/lib/planning/importOrders';
import { DEFAULT_LEAD_TIME_DAYS, INTERNATIONAL_AIR_LEAD_DAYS } from '@/lib/planning/constants';
import { createPedido } from '@/app/dashboard/pedidos/actions';
import type { OrderType } from '@/types';
import type { TransportModal } from '@/types/planning';

// Import a placed order from an .xlsx (review item 3a). SheetJS is dynamic-imported so
// the parser stays off the initial bundle. Flow: pick file → parse → preview → set the
// pedido header (name/type/modal/order date) → Criar pedido (source='import', so the
// daily ClickHouse sync never overwrites it). Head-gated by the parent.

export function ImportPedidoDialog({
  onDone,
  onCancel,
  onError,
}: {
  onDone: () => void;
  onCancel: () => void;
  onError: (msg: string | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [lines, setLines] = useState<ParsedImportLine[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);

  // Pedido header.
  const [pedidoName, setPedidoName] = useState('');
  const [orderType, setOrderType] = useState<OrderType>('internacional');
  const [modal, setModal] = useState<TransportModal>('sea');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [pending, startTransition] = useTransition();

  const defaultLead = modal === 'sea' ? DEFAULT_LEAD_TIME_DAYS : INTERNATIONAL_AIR_LEAD_DAYS;

  async function handleFile(file: File) {
    onError(null);
    setParsing(true);
    setFileName(file.name);
    try {
      // Dynamic import → SheetJS off the initial bundle.
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        raw: false,
        dateNF: 'yyyy-mm-dd',
        defval: null,
      });
      const parsed = parseImportRows(rows, { orderDate, defaultLeadDays: defaultLead });
      setLines(parsed.lines);
      setWarnings(parsed.warnings);
      if (parsed.lines.length === 0) {
        onError('Nenhuma linha válida encontrada. A planilha precisa de colunas SKU e Quantidade.');
      }
    } catch (e) {
      onError(e instanceof Error ? `Falha ao ler o arquivo: ${e.message}` : 'Falha ao ler o arquivo.');
      setLines([]);
      setWarnings([]);
    } finally {
      setParsing(false);
    }
  }

  const totalQty = lines.reduce((s, l) => s + l.qty, 0);

  const create = () => {
    onError(null);
    if (lines.length === 0) {
      onError('Selecione um arquivo com ao menos uma linha válida.');
      return;
    }
    startTransition(async () => {
      const res = await createPedido({
        modal,
        orderDate,
        pedidoName: pedidoName || null,
        orderType,
        source: 'import',
        lines: lines.map((l) => ({
          skuBase: l.skuBase,
          skuName: l.skuName,
          qty: l.qty,
          leadDays: l.leadDays,
        })),
      });
      if (res.ok) onDone();
      else onError(res.error ?? 'Erro ao criar o pedido importado.');
    });
  };

  return (
    <div className="rounded-lg border border-brand-500/30 bg-brand-500/[0.03] p-4">
      <div className="mb-3 flex items-center gap-2">
        <Upload size={15} className="text-brand-600" />
        <p className="text-sm font-medium">Importar pedido de planilha (.xlsx)</p>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onCancel} disabled={pending}>
          <X /> Fechar
        </Button>
      </div>

      {/* File picker */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
          }}
        />
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={parsing || pending}>
          {parsing ? 'Lendo…' : 'Escolher arquivo'}
        </Button>
        {fileName && <span className="text-xs text-muted-foreground">{fileName}</span>}
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        Colunas: <b>SKU</b> e <b>Quantidade</b> (obrigatórias); opcionais: Nome, ETA ou Lead (dias).
        Datas por linha e VO são ignoradas — o pedido usa o cabeçalho abaixo.
      </p>

      {/* Pedido header */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Labeled label="Nome do pedido">
          <Input value={pedidoName} onChange={(e) => setPedidoName(e.target.value)} placeholder="Ex.: Importado julho" />
        </Labeled>
        <Labeled label="Tipo">
          <div className="flex h-8 gap-0.5 rounded-md bg-muted/60 p-0.5">
            {(['internacional', 'nacional'] as OrderType[]).map((t) => (
              <button
                key={t}
                onClick={() => setOrderType(t)}
                className={cn(
                  'flex-1 rounded px-2 text-[11px] font-medium transition-colors',
                  orderType === t ? 'bg-brand-500/20 text-brand-600' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t === 'internacional' ? 'Intl' : 'Nac'}
              </button>
            ))}
          </div>
        </Labeled>
        <Labeled label="Modal (lead padrão)">
          <div className="flex h-8 gap-0.5 rounded-md bg-muted/60 p-0.5">
            {(['sea', 'air'] as TransportModal[]).map((m) => (
              <button
                key={m}
                onClick={() => setModal(m)}
                className={cn(
                  'flex-1 rounded px-2 text-[11px] font-medium transition-colors',
                  modal === m ? 'bg-brand-500/20 text-brand-600' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {m === 'sea' ? 'Marítimo' : 'Aéreo'}
              </button>
            ))}
          </div>
        </Labeled>
        <Labeled label="Data do pedido">
          <DateField value={orderDate} onChange={setOrderDate} aria-label="Data do pedido" />
        </Labeled>
      </div>

      {/* Preview */}
      {lines.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            {fmtInt(lines.length)} {lines.length === 1 ? 'linha' : 'linhas'} · {fmtInt(totalQty)} un.
            {warnings.length > 0 && <span className="text-alert-warning"> · {warnings.length} ignorada(s)</span>}
          </p>
          <div className="max-h-56 overflow-y-auto rounded-lg ring-1 ring-foreground/10">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-1.5 font-medium">SKU</th>
                  <th className="px-3 py-1.5 font-medium">Item</th>
                  <th className="px-3 py-1.5 text-right font-medium">Qtd</th>
                  <th className="px-3 py-1.5 text-right font-medium">Lead (d)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-foreground/5">
                {lines.map((l, i) => (
                  <tr key={`${l.skuBase}-${i}`} className="hover:bg-muted/20">
                    <td className="px-3 py-1.5 font-mono text-xs">{l.skuBase}</td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">{l.skuName ?? '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtInt(l.qty)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{l.leadDays}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {warnings.length > 0 && (
            <details className="mt-2 text-[11px] text-muted-foreground">
              <summary className="cursor-pointer">Ver linhas ignoradas ({warnings.length})</summary>
              <ul className="mt-1 list-disc pl-5">
                {warnings.slice(0, 20).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <Button size="sm" onClick={create} disabled={pending || lines.length === 0}>
          <Check /> {pending ? 'Criando…' : `Criar pedido (${fmtInt(lines.length)})`}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
