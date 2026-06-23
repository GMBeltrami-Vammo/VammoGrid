'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import {
  LayoutGrid,
  TrendingUp,
  ShoppingCart,
  ArrowLeftRight,
  Bell,
  LogOut,
  Settings,
} from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { cn } from '@/lib/utils';

// Navigation for the Stock Planning & Logistics Platform. Sections map to the
// engine surfaces: projection, procurement, transfers + system (alerts, admin).

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href);

  return (
    <aside className="flex h-full w-60 flex-shrink-0 flex-col bg-sidebar border-r border-sidebar-border">
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
          Planejamento de Estoque
        </p>
      </div>

      <div className="mx-4 h-px bg-sidebar-border" />

      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-5">
        <NavSection label="Geral">
          <NavLink href="/dashboard" label="Visão Geral" icon={LayoutGrid} active={isActive('/dashboard')} />
        </NavSection>

        <NavSection label="Planejamento">
          <NavLink
            href="/dashboard/projection"
            label="Projeção"
            icon={TrendingUp}
            active={isActive('/dashboard/projection')}
          />
          <NavLink
            href="/dashboard/procurement"
            label="Compras"
            icon={ShoppingCart}
            active={isActive('/dashboard/procurement')}
          />
          <NavLink
            href="/dashboard/transfers"
            label="Transferências"
            icon={ArrowLeftRight}
            active={isActive('/dashboard/transfers')}
          />
        </NavSection>

        <NavSection label="Sistema">
          <NavLink href="/dashboard/alertas" label="Alertas" icon={Bell} active={isActive('/dashboard/alertas')} />
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
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  active: boolean;
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
          active ? 'text-brand-500' : 'text-sidebar-foreground/35 group-hover:text-sidebar-foreground/60',
        )}
      />
      <span className="flex-1 truncate">{label}</span>
    </Link>
  );
}
