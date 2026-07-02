'use client';

import { PurchaseOrdersPanel } from '@/components/orders/PurchaseOrdersPanel';

export default function PedidosPage() {
  return (
    <div>
      <div className="mb-5">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-500">
          Planejamento
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Pedidos de Compra</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Visualizar e editar pedidos (VOs). Sincronizados do ClickHouse (dev.vmoto_orders) ou adicionados manualmente.
        </p>
      </div>
      <PurchaseOrdersPanel />
    </div>
  );
}
