'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { LayoutGrid, MapPin, Bell, LogOut, Truck, Bike, Settings } from 'lucide-react';
import { HUB_LIST } from '@/constants/hubs';
import { useAlerts } from '@/hooks/useAlerts';
import { ThemeToggle } from './ThemeToggle';
import { cn } from '@/lib/utils';
import type { Hub } from '@/types';

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { total: alertCount } = useAlerts();

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href);

  return (
    <aside className="flex h-full w-60 flex-shrink-0 flex-col bg-sidebar border-r border-sidebar-border">
      {/* Wordmark */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-baseline">
          <span className="text-[1.15rem] font-black uppercase tracking-[-0.03em] text-sidebar-foreground">
            vammo
          </span>
          <span className="text-[1.15rem] font-black uppercase tracking-[-0.03em] text-brand-500">
            grid
          </span>
        </div>
        <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-sidebar-foreground/35">
          Gestão de Estoque
        </p>
      </div>

      <div className="mx-4 h-px bg-sidebar-border" />

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-5">
        <NavSection label="Geral">
          <NavLink
            href="/dashboard"
            label="Visão Geral"
            icon={LayoutGrid}
            active={isActive('/dashboard')}
          />
        </NavSection>

        <NavSection label="Bases">
          {HUB_LIST.map((hub) => (
            <HubNavLink key={hub.id} hub={hub} active={isActive(`/dashboard/${hub.id}`)} />
          ))}
        </NavSection>

        <NavSection label="Planejamento">
          <NavLink
            href="/dashboard/pedidos"
            label="Pedidos & Projeção"
            icon={Truck}
            active={isActive('/dashboard/pedidos')}
          />
          <NavLink
            href="/dashboard/compatibilidade"
            label="Compatibilidade"
            icon={Bike}
            active={isActive('/dashboard/compatibilidade')}
          />
        </NavSection>

        <NavSection label="Sistema">
          <NavLink
            href="/dashboard/alertas"
            label="Alertas"
            icon={Bell}
            active={isActive('/dashboard/alertas')}
            badge={alertCount > 0 ? alertCount : undefined}
          />
          {session?.user?.isHead && (
            <NavLink
              href="/dashboard/admin"
              label="Admin"
              icon={Settings}
              active={isActive('/dashboard/admin')}
            />
          )}
        </NavSection>
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border px-3 py-3 space-y-1">
        <ThemeToggle />
        {session?.user && (
          <div className="flex items-center gap-2 px-2 py-1.5">
            {session.user.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={session.user.image}
                alt={session.user.name ?? ''}
                className="h-6 w-6 shrink-0 rounded-full ring-1 ring-sidebar-border"
              />
            )}
            <p className="min-w-0 flex-1 truncate text-xs text-sidebar-foreground/50">
              {session.user.name ?? session.user.email}
            </p>
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="shrink-0 rounded p-1 text-sidebar-foreground/35 hover:text-sidebar-foreground transition-colors"
              aria-label="Sair"
            >
              <LogOut size={13} />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

function NavSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/30">
        {label}
      </p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  active,
  badge,
  tag,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  active: boolean;
  badge?: number;
  tag?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'group flex items-center gap-2.5 rounded-md px-2 py-[7px] text-sm font-medium transition-colors',
        active
          ? 'bg-brand-500/10 text-brand-400'
          : 'text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground',
      )}
    >
      <Icon
        size={14}
        className={cn(
          'shrink-0',
          active
            ? 'text-brand-500'
            : 'text-sidebar-foreground/35 group-hover:text-sidebar-foreground/60',
        )}
      />
      <span className="flex-1 truncate">{label}</span>
      {tag && (
        <span className="rounded px-1 text-[9px] font-bold uppercase tracking-wide bg-sidebar-foreground/8 text-sidebar-foreground/35">
          {tag}
        </span>
      )}
      {badge !== undefined && (
        <span
          className={cn(
            'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold',
            active
              ? 'bg-brand-500/20 text-brand-300'
              : 'bg-alert-error/20 text-alert-error',
          )}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}

function HubNavLink({ hub, active }: { hub: Hub; active: boolean }) {
  return (
    <Link
      href={`/dashboard/${hub.id}`}
      className={cn(
        'group flex items-center gap-2.5 rounded-md px-2 py-[7px] text-sm font-medium transition-colors',
        active
          ? 'bg-brand-500/10 text-brand-400'
          : 'text-sidebar-foreground/55 hover:bg-sidebar-accent hover:text-sidebar-foreground',
      )}
    >
      <MapPin
        size={14}
        className={cn(
          'shrink-0',
          active
            ? 'text-brand-500'
            : 'text-sidebar-foreground/35 group-hover:text-sidebar-foreground/60',
        )}
      />
      <span className="flex-1 truncate">{hub.name}</span>
      {hub.isRecoveryCenter && (
        <span className="rounded px-1 text-[9px] font-bold uppercase tracking-wide text-sidebar-foreground/30">
          RC
        </span>
      )}
    </Link>
  );
}
