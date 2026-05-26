'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { HUB_LIST } from '@/constants/hubs';
import { cn } from '@/lib/utils';

const NAV_LINKS = [
  { href: '/dashboard', label: 'Visão Geral' },
  ...HUB_LIST.map((hub) => ({
    href: `/dashboard/${hub.id}`,
    label: hub.name,
  })),
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-56 flex-shrink-0 flex-col border-r bg-muted/30 px-3 py-4">
      <div className="mb-6 px-2">
        <span className="text-lg font-bold tracking-tight text-foreground">
          Vammo<span className="text-emerald-500">Grid</span>
        </span>
        <p className="text-xs text-muted-foreground">Gestão de Estoque</p>
      </div>

      <nav className="flex flex-col gap-1">
        {NAV_LINKS.map(({ href, label }) => {
          const isActive =
            href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname.startsWith(href);

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-emerald-600 text-white'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
