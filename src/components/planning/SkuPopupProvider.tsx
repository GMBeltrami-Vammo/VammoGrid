'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { SkuPopup } from './SkuPopup';

// App-wide SKU popup (Feature D). A single Dialog + SkuPopup mounted once in the dashboard
// layout; any descendant opens it via useSkuPopup().openSku(skuBase). Returns null outside
// the provider so <SkuLink> can fall back to plain navigation.

interface SkuPopupCtx {
  openSku: (skuBase: string) => void;
}

const Ctx = createContext<SkuPopupCtx | null>(null);

export function useSkuPopup(): SkuPopupCtx | null {
  return useContext(Ctx);
}

const LABEL_ID = 'sku-popup-title';

export function SkuPopupProvider({ children }: { children: ReactNode }) {
  const [skuBase, setSkuBase] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const openSku = useCallback((s: string) => {
    setSkuBase(s);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  // Stable identity so opening/closing the popup does not re-render every useSkuPopup()
  // consumer (the ~300 SkuLink rows on the SKUs/Projeção Global tables). decisions.MD #37.
  const value = useMemo(() => ({ openSku }), [openSku]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <Dialog open={open} onClose={close} labelledBy={LABEL_ID}>
        <SkuPopup skuBase={skuBase} open={open} onClose={close} labelId={LABEL_ID} />
      </Dialog>
    </Ctx.Provider>
  );
}
