import { Sidebar } from '@/components/layout/Sidebar';
import { FilterProvider } from '@/lib/filter/FilterContext';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <FilterProvider>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </FilterProvider>
  );
}
