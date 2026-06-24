import { cookies } from 'next/headers';
import { Sidebar } from '@/components/layout/Sidebar';
import { FilterBar } from '@/components/planning/FilterBar';
import { ScenarioBar } from '@/components/planning/ScenarioBar';
import { FILTER_COOKIE, parseFilterCookie } from '@/lib/planning/filter';
import { SCENARIO_COOKIE, parseScenarioCookie } from '@/lib/planning/scenario';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const filter = parseFilterCookie(cookieStore.get(FILTER_COOKIE)?.value);
  const scenario = parseScenarioCookie(cookieStore.get(SCENARIO_COOKIE)?.value);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">
        {/* key tied to the filter → remounts (re-seeds its local state) whenever the
            shared cookie changes, so the bar reflects edits made from other controls
            (e.g. the category chips on the SKUs page). */}
        <FilterBar
          key={`${filter.category ?? ''}|${filter.models.join(',')}|${filter.q}|${filter.withForecast}`}
          initial={filter}
        />
        <ScenarioBar initial={scenario} />
        {children}
      </main>
    </div>
  );
}
