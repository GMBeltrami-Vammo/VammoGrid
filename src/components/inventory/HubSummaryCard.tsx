'use client';

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useHubInventory } from '@/hooks/useInventory';
import { useApplyFilter } from '@/lib/filter/FilterContext';
import type { Hub } from '@/types';

export function HubSummaryCard({ hub }: { hub: Hub }) {
  const { data: rawItems, isLoading, isError } = useHubInventory(hub.id);
  const items = useApplyFilter(rawItems);

  const criticalCount = items.filter((i) => i.dohStatus === 'critical').length;
  const warningCount = items.filter((i) => i.dohStatus === 'warning').length;

  return (
    <Link href={`/dashboard/${hub.id}`} className="block focus:outline-none">
      <Card className="cursor-pointer transition-colors hover:border-brand-500/50">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold">{hub.name}</CardTitle>
            {hub.isRecoveryCenter && (
              <Badge variant="outline" className="text-xs text-brand-500 border-brand-500/30">
                Recuperação
              </Badge>
            )}
          </div>
        </CardHeader>

        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-32" />
            </div>
          ) : isError ? (
            <p className="text-sm text-alert-error">Erro ao carregar dados</p>
          ) : (
            <div className="space-y-1 text-sm">
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">{items.length}</span> SKUs monitorados
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                {criticalCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-alert-error/12 px-2 py-0.5 text-xs font-medium text-alert-error border border-alert-error/20">
                    {criticalCount} crítico{criticalCount > 1 ? 's' : ''}
                  </span>
                )}
                {warningCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-alert-warning/12 px-2 py-0.5 text-xs font-medium text-[#b8a800] border border-alert-warning/20 dark:text-alert-warning dark:border-alert-warning/25">
                    {warningCount} atenção
                  </span>
                )}
                {criticalCount === 0 && warningCount === 0 && items.length > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-500/10 px-2 py-0.5 text-xs font-medium text-brand-700 border border-brand-300/30 dark:text-brand-400 dark:border-brand-500/20">
                    Tudo OK
                  </span>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
