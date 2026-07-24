'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useSkuPopup } from './SkuPopupProvider';

// Shared SKU link: left-click opens the app-wide popup (Feature D); ctrl/cmd/shift/middle
// click still navigates to the full page in a new tab (default preserved). Falls back to
// plain navigation when rendered outside the SkuPopupProvider. Renders an <a href> to the
// full SKU page, so the deep link and accessibility are intact.
export function SkuLink({
  skuBase,
  className,
  children,
  title,
}: {
  skuBase: string;
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  const ctx = useSkuPopup();
  const href = `/dashboard/estoque?sku=${encodeURIComponent(skuBase)}`;
  return (
    <Link
      href={href}
      prefetch={false}
      title={title}
      className={className}
      onClick={(e) => {
        if (!ctx) return; // no provider → let the browser navigate
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; // new-tab intent
        e.preventDefault();
        ctx.openSku(skuBase);
      }}
    >
      {children}
    </Link>
  );
}
