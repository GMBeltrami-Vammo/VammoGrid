import { auth } from '@/auth';
import { fetchSuppliers, fetchSkuSuppliers } from '@/lib/planning/source/suppliers';
import { PageHeader } from '@/components/planning/ui';
import { SuppliersManager } from '@/components/suppliers/SuppliersManager';

export const dynamic = 'force-dynamic';

// Fornecedores (review 4b): cadastro + quantos SKUs cada um abastece. Os vínculos
// SKU↔fornecedor são gerenciados no cadastro do SKU (Estoque).
export default async function FornecedoresPage() {
  const [suppliers, links, session] = await Promise.all([fetchSuppliers(), fetchSkuSuppliers(), auth()]);
  const isHead = session?.user?.isHead ?? false;

  const skusBySupplier: Record<string, string[]> = {};
  for (const l of links) {
    (skusBySupplier[l.supplierId] ??= []).push(l.skuBase);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Fornecedores"
        title="Cadastro de fornecedores"
        subtitle="Fornecedores nacionais e internacionais. Vincule SKUs a fornecedores no cadastro de cada SKU (Estoque) para habilitar “pedido por fornecedor” no Novo Pedido."
      />
      <SuppliersManager suppliers={suppliers} skusBySupplier={skusBySupplier} isHead={isHead} />
    </div>
  );
}
