'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { HUB_LIST } from '@/constants/hubs';
import { useAlerts } from '@/hooks/useAlerts';
import { ThemeToggle } from './ThemeToggle';
import { cn } from '@/lib/utils';

const NAV_LINKS = [
  { href: '/dashboard', label: 'Visão Geral' },
  ...HUB_LIST.map((hub) => ({
    href: `/dashboard/${hub.id}`,
    label: hub.name,
  })),
  { href: '/dashboard/alertas', label: 'Alertas' },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { total: alertCount } = useAlerts();

  return (
    <aside className="flex h-full w-56 flex-shrink-0 flex-col border-r bg-muted/30 px-3 py-4">
      {/* Logo — Vammo wordmark style: bold, uppercase, tight tracking */}
      <div className="mb-6 px-2">
        <span className="text-xl font-extrabold uppercase tracking-tight text-foreground">
          Vammo<span className="text-brand-500">Grid</span>
        </span>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Gestão de Estoque
        </p>
      </div>

      {/* Navigation */}
      <nav className="flex flex-col gap-1">
        {NAV_LINKS.map(({ href, label }) => {
          const isActive =
            href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname.startsWith(href);

          const showBadge = href === '/dashboard/alertas' && alertCount > 0;

          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-brand-600 text-white'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <span>{label}</span>
              {showBadge && (
                <span
                  className={cn(
                    'ml-2 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-xs font-semibold',
                    isActive
                      ? 'bg-white text-brand-700'
                      : 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300',
                  )}
                >
                  {alertCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Theme toggle + user + sign out */}
      <div className="mt-auto border-t pt-2">
        <ThemeToggle />
        {session?.user && (
          <div className="mt-2 border-t pt-3">
            <div className="mb-1 flex items-center gap-2 px-2">
              {session.user.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={session.user.image}
                  alt={session.user.name ?? ''}
                  className="h-6 w-6 rounded-full"
                />
              )}
              <p className="truncate text-xs text-muted-foreground">
                {session.user.name ?? session.user.email}
              </p>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="w-full rounded-md px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Sair
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
