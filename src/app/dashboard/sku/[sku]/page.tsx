import { redirect } from 'next/navigation';

// The SKU deep-dive was merged into /dashboard/estoque (single canonical view).
// This route is kept so existing links (Compras, Pedidos, Transferências, SKUs,
// Compatibilidade, weekly grid) still resolve — it redirects to the merged page.
export const dynamic = 'force-dynamic';

export default async function SkuDetailRedirect({ params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  redirect(`/dashboard/estoque?sku=${encodeURIComponent(sku)}`);
}
