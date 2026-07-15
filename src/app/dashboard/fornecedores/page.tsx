import { auth } from '@/auth';
import { fetchSuppliers, fetchSkuSuppliers, fetchSupplierModals } from '@/lib/planning/source/suppliers';
import { fetchStockStates } from '@/lib/planning/source/stock';
import { fetchSkuPolicies } from '@/lib/planning/source/policies';
import { PageHeader } from '@/components/planning/ui';
import { SuppliersManager } from '@/components/suppliers/SuppliersManager';

export const dynamic = 'force-dynamic';

// Fornecedores (review 4b): cadastro + quais SKUs (ID + nome) cada um abastece. Os
// vínculos SKU↔fornecedor são gerenciados no cadastro do SKU (Estoque).
export default async function FornecedoresPage() {
  const [suppliers, links, modals, stocks, policies, session] = await Promise.all([
    fetchSuppliers(),
    fetchSkuSuppliers(),
    fetchSupplierModals(),
    fetchStockStates(new Date().toISOString()),
    fetchSkuPolicies(),
    auth(),
  ]);
  const isHead = session?.user?.isHead ?? false;

  const skusBySupplier: Record<string, string[]> = {};
  for (const l of links) {
    (skusBySupplier[l.supplierId] ??= []).push(l.skuBase);
  }
  const modalsBySupplier: Record<string, typeof modals> = {};
  for (const m of modals) {
    (modalsBySupplier[m.supplierId] ??= []).push(m);
  }
  // sku_base → display name (warehouse snapshot ∪ manually-added policy names).
  const skuNames: Record<string, string> = {};
  for (const s of stocks) skuNames[s.skuBase] = s.skuName;
  for (const [base, pol] of policies) {
    if (!skuNames[base] && pol.skuName) skuNames[base] = pol.skuName;
  }

  return (
    <div>
      <PageHeader
        eyebrow="Fornecedores"
        title="Cadastro de fornecedores"
        subtitle="Fornecedores nacionais e internacionais. Vincule SKUs a fornecedores no cadastro de cada SKU (Estoque) para habilitar “pedido por fornecedor” no Novo Pedido."
      />
      <SuppliersManager
        suppliers={suppliers}
        skusBySupplier={skusBySupplier}
        skuNames={skuNames}
        modalsBySupplier={modalsBySupplier}
        isHead={isHead}
      />
    </div>
  );
}
