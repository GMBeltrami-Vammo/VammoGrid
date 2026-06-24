import { redirect } from 'next/navigation';

export default async function ProjectionPage({
  searchParams,
}: {
  searchParams: Promise<{ sku?: string }>;
}) {
  const sp = await searchParams;
  redirect(sp.sku ? `/dashboard/estoque?sku=${encodeURIComponent(sp.sku)}` : '/dashboard/estoque');
}
