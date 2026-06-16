'use client';

import { CompatPanel } from '@/components/compat/CompatPanel';

export default function CompatibilidadePage() {
  return (
    <div>
      <div className="mb-4">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-500">
          Planejamento
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Compatibilidade</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Quais peças servem em cada modelo de moto (CPX, VS1, VS2, COMFORT)
        </p>
      </div>

      <CompatPanel />
    </div>
  );
}
