'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { deletePedido } from '@/app/dashboard/pedidos/actions';

// Delete a whole pedido (all lines of the VO). Used on the pedido detail page — on
// success it navigates back to the pedidos list. The list card has its own inline
// delete (it just refreshes in place).
export function DeletePedidoButton({ ids, label = 'Excluir pedido' }: { ids: string[]; label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const onClick = () => {
    if (!window.confirm('Excluir este pedido e todas as suas linhas? Esta ação não pode ser desfeita.')) return;
    setErr(null);
    start(async () => {
      const res = await deletePedido(ids);
      if (res.ok) {
        router.push('/dashboard/pedidos');
        router.refresh();
      } else {
        setErr(res.error ?? 'Erro ao excluir.');
      }
    });
  };

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="ghost"
        onClick={onClick}
        disabled={pending}
        className="text-muted-foreground hover:text-alert-error"
      >
        <Trash2 /> {pending ? 'Excluindo…' : label}
      </Button>
      {err && <span className="text-xs text-alert-error">{err}</span>}
    </div>
  );
}
