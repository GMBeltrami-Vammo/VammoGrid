import { cookies } from 'next/headers';
import { Sidebar } from '@/components/layout/Sidebar';
import { FilterBar } from '@/components/planning/FilterBar';
import { FILTER_COOKIE, parseFilterCookie } from '@/lib/planning/filter';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const filter = parseFilterCookie(cookieStore.get(FILTER_COOKIE)?.value);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">
        <FilterBar initial={filter} />
        {children}
      </main>
    </div>
  );
}
